"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = "http://127.0.0.1:4173";
let server;
let mockAiServer;

function createMockAiServer() {
  return http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = payload.input[0].content[0].text;
      const brief = JSON.parse(prompt.slice(prompt.indexOf("{")));
      const questions = ["第一版必须包含哪些功能？"];
      if (!brief.budget) questions.push("项目预算大概是多少？");
      if (!brief.deadline) questions.push("希望什么时候完成第一版？");
      const plan = {
        clientInsight: `${brief.name}希望用 AI 改善关键业务流程。`,
        coreProblem: brief.problem,
        summary: `${brief.name}需要解决：${brief.problem}`,
        solution: `围绕“${brief.aiGoal}”设计可验证的 AI 工作流。`,
        deliverables: ["需求与边界确认清单", "核心功能原型"],
        steps: [
          { name: "确认范围", description: "确认首版目标、边界与验收标准。" },
          { name: "实现与验证", description: "实现核心流程并使用真实样例验证。" }
        ],
        questions,
        difficulty: "Medium",
        aiOpportunities: ["信息整理", "内容生成", "质量检查"]
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(plan) }] }]
      }));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("测试服务器未能启动");
}

function findBrowser() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function fillRequiredFields(page) {
  await page.locator("#project-name").fill("星河教育 AI 招生咨询项目");
  await page.locator("#industry").fill("职业教育");
  await page.locator("#problem").fill("人工每天重复回答大量课程和报名问题，回复口径不一致。");
  await page.locator("#audience").fill("咨询课程的在职人士");
  await page.locator("#ai-goal").fill("整理课程知识，并为客服生成准确的回复建议。");
}

async function run() {
  mockAiServer = createMockAiServer();
  await new Promise((resolve) => mockAiServer.listen(0, "127.0.0.1", resolve));
  const mockAddress = mockAiServer.address();
  server = spawn(process.execPath, ["server.js", "4173"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENAI_API_KEY: "e2e-test-key",
      OPENAI_MODEL: "e2e-test-model",
      OPENAI_BASE_URL: `http://127.0.0.1:${mockAddress.port}`
    }
  });
  await waitForServer();
  const executablePath = findBrowser();
  const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== baseUrl) externalRequests.push(request.url());
  });

  await page.goto(baseUrl);
  assert.equal(await page.title(), "AI Client Brief");
  assert.equal(await page.locator("#brief-form input, #brief-form textarea").count(), 8);
  assert.match(await page.locator(".brand").textContent(), /AI CLIENT BRIEF/);

  await page.locator("#generate-button").click();
  assert.equal(await page.locator("#form-alert").textContent(), "请填写「项目 / 客户名称」。");
  assert.equal(await page.locator(":focus").getAttribute("id"), "project-name");

  await fillRequiredFields(page);
  await page.evaluate(() => {
    const button = document.getElementById("generate-button");
    button.click();
    button.click();
  });
  assert.equal(await page.locator("#generate-button").isDisabled(), true);
  assert.equal(await page.locator("#result-loading").isVisible(), true);
  assert.match(await page.locator("#result-loading h3").textContent(), /Building your project intelligence/);

  await page.locator("#result-content").waitFor({ state: "visible" });
  assert.equal(await page.locator("#result-modules .result-module").count(), 7);
  assert.match(await page.locator("#result-content .result-intro").textContent(), /ANALYSIS COMPLETE/);
  assert.match(await page.locator("#result-modules").textContent(), /项目预算大概是多少/);
  assert.match(await page.locator("#result-modules").textContent(), /希望什么时候完成第一版/);
  assert.equal(externalRequests.length, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.resolve(__dirname, "desktop-result.png"), fullPage: true });

  await page.locator("#save-button").click();
  await page.locator(".toast", { hasText: "项目已保存。" }).waitFor();
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-client-brief-v1-projects")));
  assert.equal(stored.length, 1);
  const originalId = stored[0].id;
  assert.equal(stored[0].budget, "");
  assert.equal(stored[0].deadline, "");

  await page.locator("#project-status").selectOption("执行中");
  await page.locator("#save-button").click();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-client-brief-v1-projects")));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, originalId);
  assert.equal(stored[0].status, "执行中");

  await page.locator("#history-button").click();
  assert.equal(await page.locator(".history-card").count(), 1);
  await page.locator('.history-card-actions button[data-action="view"]').click();
  assert.match(await page.locator("#detail-content").textContent(), /星河教育 AI 招生咨询项目/);
  assert.match(await page.locator("#detail-content").textContent(), /由 AI/);

  await page.locator("#detail-edit-button").click();
  await page.locator("#problem").fill("人工重复答疑且夜间无法及时回复，口径也不一致。");
  assert.match(await page.locator("#result-status").textContent(), /INPUT CHANGED/);
  await page.locator("#generate-button").click();
  await page.locator("#result-content").waitFor({ state: "visible" });
  assert.match(await page.locator("#result-modules").textContent(), /夜间无法及时回复/);
  await page.locator("#save-button").click();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-client-brief-v1-projects")));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, originalId);

  await page.locator("#brand-home").click();
  await page.locator("#project-name").fill("青山餐饮门店报表项目");
  await page.locator("#industry").fill("连锁餐饮");
  await page.locator("#problem").fill("门店日报靠人工汇总，容易遗漏。");
  await page.locator("#audience").fill("区域经理");
  await page.locator("#ai-goal").fill("自动汇总门店日报并标记异常。");
  await page.locator("#save-button").click();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-client-brief-v1-projects")));
  assert.equal(stored.length, 2);

  await page.locator("#history-button").click();
  const secondCard = page.locator(".history-card", { hasText: "青山餐饮门店报表项目" });
  await secondCard.locator('button[data-action="delete"]').click();
  assert.equal(await page.locator("#confirm-description").textContent(), "确定要删除这个项目吗？删除后无法恢复。");
  await page.locator("#confirm-cancel").click();
  assert.equal(await page.locator(".history-card").count(), 2);
  await secondCard.locator('button[data-action="delete"]').click();
  await page.locator("#confirm-delete").click();
  assert.equal(await page.locator(".history-card").count(), 1);

  await page.reload();
  assert.equal(await page.locator("#history-count").textContent(), "1");
  const reopenedPage = await context.newPage();
  await reopenedPage.goto(baseUrl);
  assert.equal(await reopenedPage.locator("#history-count").textContent(), "1");
  await reopenedPage.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);
  assert.equal(await page.locator("#workspace-view").isVisible(), true);
  assert.equal(await page.locator(".brand").isVisible(), true);
  assert.equal(await page.locator("body").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: path.resolve(__dirname, "mobile-initial.png"), fullPage: true });

  const blockedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await blockedContext.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "__ai_client_brief_storage_probe__" || key === "ai-client-brief-v1-projects") {
        throw new DOMException("Access denied", "SecurityError");
      }
      return original.call(this, key, value);
    };
  });
  const blockedPage = await blockedContext.newPage();
  await blockedPage.goto(baseUrl);
  assert.equal(await blockedPage.locator("#storage-alert").isVisible(), true);
  assert.match(await blockedPage.locator("#storage-alert").textContent(), /浏览器存储不可用/);
  await blockedContext.close();

  assert.equal(pageErrors.length, 0, `页面错误：${pageErrors.join("; ")}`);
  assert.equal(externalRequests.length, 0, `检测到外部请求：${externalRequests.join("; ")}`);
  await context.close();
  await browser.close();
  console.log("E2E PASS: AI 生成、保存、查看、编辑、删除、持久化及前端密钥隔离均通过");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) server.kill();
    if (mockAiServer) await new Promise((resolve) => mockAiServer.close(resolve));
  });
