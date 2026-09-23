"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STORAGE_KEY,
  REQUIRED_FIELDS,
  validateRequired,
  normalizeAiResult,
  createLocalDemoPlan,
  readProjects,
  writeProjects,
  upsertProject,
  removeProject
} = require("../core.js");

const validForm = {
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

const validResult = {
  clientInsight: "客户希望降低重复咨询成本并统一服务质量。",
  coreProblem: "人工答疑效率低，回复口径不一致。",
  summary: "星河教育希望面向课程咨询者减少重复答疑，由 AI 整理咨询并生成回复建议。",
  solution: "建立课程知识库并由 AI 生成可审核的回复建议。",
  deliverables: ["课程知识库整理", "咨询回复建议模块"],
  steps: [
    { name: "需求确认", description: "确认高频咨询范围和回复审核流程。" },
    { name: "试运行", description: "用真实咨询样本验证建议的准确性。" }
  ],
  questions: ["可用于整理知识库的课程资料有哪些？", "项目预算范围是多少？"],
  difficulty: "Medium",
  aiOpportunities: ["知识检索", "咨询分类", "回复建议生成"]
};

test("前五个字段逐项校验并指出具体字段", () => {
  for (const field of REQUIRED_FIELDS) {
    const data = { ...validForm, [field.key]: "  " };
    const result = validateRequired(data);
    assert.equal(result.valid, false);
    assert.equal(result.field, field.key);
    assert.equal(result.message, `请填写「${field.label}」。`);
  }
});

test("三个选填字段为空仍可生成", () => {
  assert.deepEqual(validateRequired(validForm), { valid: true, field: null, message: "" });
});

test("方案标准结构与中文键结构均可解析", () => {
  assert.deepEqual(normalizeAiResult(validResult), validResult);
  const chinese = {
    "客户需求摘要": validResult.summary,
    "客户洞察": validResult.clientInsight,
    "客户真正想解决的问题": validResult.coreProblem,
    "推荐解决方案": validResult.solution,
    "建议交付内容": validResult.deliverables,
    "建议工作步骤": validResult.steps.map((step) => ({
      "步骤名称": step.name,
      "步骤说明": step.description
    })),
    "向客户确认的问题": validResult.questions,
    "项目难度": validResult.difficulty,
    "AI可以承担哪些工作": validResult.aiOpportunities
  };
  assert.deepEqual(normalizeAiResult(chinese), validResult);
});

test("方案内容带代码围栏时可以容错，错误结构会被拒绝", () => {
  const fenced = `说明文字\n\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``;
  assert.deepEqual(normalizeAiResult(fenced), validResult);
  assert.throws(() => normalizeAiResult("不是 JSON"), /有效 JSON/);
  assert.throws(() => normalizeAiResult({ summary: "只有摘要" }), /必须是数组/);
});

test("本地规则生成四模块并识别信息缺口", () => {
  const result = createLocalDemoPlan(validForm);
  assert.match(result.summary, /星河教育 AI 招生咨询项目/);
  assert.match(result.summary, /预算尚未提供/);
  assert.ok(result.deliverables.length >= 4);
  assert.equal(result.steps.length, 6);
  assert.ok(result.questions.some((item) => item.includes("预算")));
  assert.ok(result.questions.some((item) => item.includes("第一版")));
});

test("本地规则保留已提供的预算和时间，不将其列为缺口", () => {
  const result = createLocalDemoPlan({ ...validForm, budget: "5 万元", deadline: "六周内" });
  assert.match(result.summary, /5 万元/);
  assert.match(result.summary, /六周内/);
  assert.equal(result.questions.some((item) => item.startsWith("项目预算大概是多少")), false);
});

test("项目可写入、读取、按 ID 更新且不会重复", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
  const project = { id: "p-1", name: "项目 A", updatedAt: "2026-09-10T08:00:00.000Z" };
  let projects = upsertProject([], project);
  projects = upsertProject(projects, { ...project, name: "项目 A（修改）" });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "项目 A（修改）");

  writeProjects(storage, projects);
  assert.ok(values.has(STORAGE_KEY));
  assert.deepEqual(readProjects(storage), projects);

  projects = removeProject(projects, "p-1");
  assert.deepEqual(projects, []);
});

test("localStorage 不可用时抛出明确错误", () => {
  const brokenStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("quota"); }
  };
  assert.throws(() => readProjects(brokenStorage), /denied/);
  assert.throws(() => writeProjects(brokenStorage, []), /quota/);
});
