"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, extractOutputText } = require("../server.js");

const validBrief = {
  name: "星河教育 AI 招生咨询项目",
  industry: "职业教育",
  problem: "人工重复回答课程与报名问题",
  audience: "咨询课程的在职人士",
  aiGoal: "自动整理咨询并生成准确回复建议",
  budget: "",
  deadline: "",
  other: "",
  status: "待沟通"
};

const validPlan = {
  clientInsight: "客户希望提升招生咨询效率，同时统一服务质量。",
  coreProblem: "重复咨询占用大量人工时间，且回复口径不一致。",
  summary: "为星河教育整理招生咨询知识并生成客服回复建议。",
  solution: "建立可审核的课程知识库与 AI 回复建议流程。",
  deliverables: ["咨询知识清单", "回复建议原型"],
  steps: [
    { name: "确认范围", description: "确认高频问题与人工审核边界。" },
    { name: "样例验证", description: "使用真实咨询记录验证回复质量。" }
  ],
  questions: ["首版需要覆盖哪些课程？"],
  difficulty: "Medium",
  aiOpportunities: ["知识检索", "回复建议生成", "咨询内容分类"]
};

const silentLogger = { error() {} };

async function withServer(options, callback) {
  const server = createServer({ logger: silentLogger, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("可从 Responses API 原始 output 中提取文本", () => {
  const text = extractOutputText({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(validPlan) }] }]
  });
  assert.deepEqual(JSON.parse(text), validPlan);
});

test("POST /api/generate 校验客户需求", async () => {
  await withServer({ env: {} }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "只有名称" })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.match(body.error.message, /客户行业/);
  });
});

test("未配置 API Key 时返回明确提示", async () => {
  await withServer({ env: {} }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBrief)
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AI_NOT_CONFIGURED");
    assert.match(body.error.message, /AI_API_KEY/);
  });
});

test("AI 成功响应会规范化为固定项目分析结构", async () => {
  let upstreamRequest;
  const fetchImpl = async (url, options) => {
    upstreamRequest = { url, options };
    return new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(validPlan) }] }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await withServer({
    env: { AI_API_KEY: "test-key", AI_MODEL: "test-model" },
    fetchImpl
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBrief)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), validPlan);
  });

  assert.equal(upstreamRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(upstreamRequest.options.headers.Authorization, "Bearer test-key");
  const requestBody = JSON.parse(upstreamRequest.options.body);
  assert.equal(requestBody.model, "test-model");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.deepEqual(requestBody.text.format.schema.required, [
    "clientInsight", "coreProblem", "summary", "solution", "deliverables",
    "steps", "questions", "difficulty", "aiOpportunities"
  ]);
});

test("兼容服务可使用 Chat Completions JSON 模式", async () => {
  let upstreamRequest;
  const fetchImpl = async (url, options) => {
    upstreamRequest = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validPlan) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await withServer({
    env: { AI_API_KEY: "test-key", AI_MODEL: "test-model", AI_API_MODE: "chat" },
    fetchImpl
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBrief)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), validPlan);
  });

  assert.equal(upstreamRequest.url, "https://api.openai.com/v1/chat/completions");
  const requestBody = JSON.parse(upstreamRequest.options.body);
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.reasoning_effort, "low");
});

test("上游限流会返回可操作的错误提示", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ error: { message: "rate limited" } }),
    { status: 429, headers: { "Content-Type": "application/json" } }
  );

  await withServer({ env: { AI_API_KEY: "test-key" }, fetchImpl }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBrief)
    });
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(body.error.code, "AI_RATE_LIMITED");
    assert.match(body.error.message, /繁忙或额度不足/);
    assert.equal(JSON.stringify(body).includes("rate limited"), false);
  });
});

test("上游返回无效内容时不会把内部解析错误暴露给前端", async () => {
  const fetchImpl = async () => new Response("not-json", { status: 200 });

  await withServer({ env: { AI_API_KEY: "test-key" }, fetchImpl }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBrief)
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.error.code, "AI_INVALID_RESPONSE");
    assert.match(body.error.message, /无法识别/);
  });
});
