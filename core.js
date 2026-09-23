(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AppCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "ai-client-brief-v1-projects";
  const PROJECT_STATUSES = ["待沟通", "方案中", "执行中", "已完成"];
  const REQUIRED_FIELDS = [
    { key: "name", label: "项目 / 客户名称" },
    { key: "industry", label: "客户行业" },
    { key: "problem", label: "客户想解决的问题" },
    { key: "audience", label: "目标客户" },
    { key: "aiGoal", label: "希望 AI 帮助完成什么" }
  ];

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function sanitizeFormData(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      name: cleanText(source.name),
      industry: cleanText(source.industry),
      problem: cleanText(source.problem),
      audience: cleanText(source.audience),
      aiGoal: cleanText(source.aiGoal),
      budget: cleanText(source.budget),
      deadline: cleanText(source.deadline),
      other: cleanText(source.other),
      status: PROJECT_STATUSES.includes(source.status) ? source.status : PROJECT_STATUSES[0]
    };
  }

  function validateRequired(value) {
    const formData = sanitizeFormData(value);
    const missing = REQUIRED_FIELDS.find((field) => !formData[field.key]);
    if (!missing) return { valid: true, field: null, message: "" };
    return {
      valid: false,
      field: missing.key,
      message: `请填写「${missing.label}」。`
    };
  }

  function createProjectId(now) {
    const stamp = typeof now === "number" ? now : Date.now();
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `project-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeStringList(value, fieldName) {
    if (!Array.isArray(value)) {
      throw new Error(`${fieldName} 必须是数组`);
    }
    const items = value.map(cleanText).filter(Boolean);
    if (!items.length) {
      throw new Error(`${fieldName} 不能为空`);
    }
    return items;
  }

  function normalizeSteps(value) {
    if (!Array.isArray(value) || !value.length) {
      throw new Error("建议工作步骤必须是非空数组");
    }

    return value.map((step, index) => {
      if (typeof step === "string") {
        const text = cleanText(step);
        if (!text) throw new Error(`第 ${index + 1} 个工作步骤为空`);
        return { name: `步骤 ${index + 1}`, description: text };
      }

      if (!step || typeof step !== "object") {
        throw new Error(`第 ${index + 1} 个工作步骤格式错误`);
      }

      const name = cleanText(step.name || step["步骤名称"] || step.title);
      const description = cleanText(step.description || step["步骤说明"] || step.content);
      if (!name || !description) {
        throw new Error(`第 ${index + 1} 个工作步骤缺少名称或说明`);
      }
      return { name, description };
    });
  }

  function parseJsonString(value) {
    const text = cleanText(value);
    if (!text) throw new Error("方案内容为空");

    try {
      return JSON.parse(text);
    } catch (_) {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced) return JSON.parse(fenced[1]);

      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
      throw new Error("方案内容不是有效 JSON");
    }
  }

  function normalizeAiResult(value) {
    const source = typeof value === "string" ? parseJsonString(value) : value;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("方案格式错误");
    }

    const summary = cleanText(source.summary || source["客户需求摘要"]);
    if (!summary) throw new Error("客户需求摘要不能为空");

    const deliverables = normalizeStringList(
      source.deliverables || source["建议交付内容"],
      "建议交付内容"
    );
    const steps = normalizeSteps(source.steps || source["项目执行步骤"] || source["建议工作步骤"]);
    const questions = normalizeStringList(
      source.questions || source["还需要向客户确认的问题"] || source["向客户确认的问题"],
      "向客户确认的问题"
    );

    return {
      clientInsight: cleanText(source.clientInsight || source["客户洞察"] || summary),
      coreProblem: cleanText(source.coreProblem || source["客户真正想解决的问题"] || summary),
      summary,
      solution: cleanText(source.solution || source["推荐解决方案"] || summary),
      deliverables,
      steps,
      questions,
      difficulty: cleanText(source.difficulty || source["项目难度"] || "待评估"),
      aiOpportunities: Array.isArray(source.aiOpportunities || source["AI可以承担哪些工作"])
        ? normalizeStringList(source.aiOpportunities || source["AI可以承担哪些工作"], "AI 可以承担的工作")
        : ["根据客户资料辅助整理、分析并生成建议。"]
    };
  }

  function createLocalDemoPlan(value) {
    const data = sanitizeFormData(value);
    const validation = validateRequired(data);
    if (!validation.valid) throw new Error(validation.message);

    const context = `${data.problem} ${data.aiGoal} ${data.other}`;
    const deliverables = [
      `需求与边界确认清单：围绕“${data.aiGoal}”明确首版范围、输入、输出和人工处理边界。`
    ];

    if (/客服|咨询|问答|回复|知识/.test(context)) {
      deliverables.push("知识资料与回复口径清单：梳理可用资料、常见问题、标准答案及需要人工升级的情形。");
    }
    if (/数据|报表|分析|统计|指标/.test(context)) {
      deliverables.push("数据字段与报表原型：明确数据来源、计算口径、异常规则和需要展示的核心结果。");
    }
    if (/自动|流程|审批|工单|执行/.test(context)) {
      deliverables.push("目标流程与自动化规则原型：标明触发条件、处理动作、人工确认点和失败处理方式。");
    }
    if (/内容|文案|文章|视频|营销/.test(context)) {
      deliverables.push("内容模板与审核规则：定义输入素材、输出结构、品牌限制和发布前人工检查项。");
    }
    if (deliverables.length === 1) {
      deliverables.push(`核心功能原型：用一条完整业务流程演示如何支持“${data.aiGoal}”，具体实现方式待确认。`);
    }
    deliverables.push(
      "可操作的页面原型：覆盖需求录入、结果查看、信息补充和状态更新等关键动作。",
      "测试与验收清单：使用客户确认的真实样例检查结果准确性、异常处理和业务可用性。",
      "简明使用说明：记录适用场景、操作步骤、已知限制和人工介入要求。"
    );

    const questions = [
      "第一版必须包含哪些功能，哪些内容可以延后？",
      "项目需要使用哪些现有资料、数据或业务系统？谁负责提供和更新？",
      "实际使用人员有哪些角色，大概有多少人，他们分别需要完成什么操作？",
      "系统只需要提供建议，还是需要在人工确认后执行实际操作？",
      "最终希望通过独立网页、嵌入现有系统还是其他形式使用和交付？",
      "客户将用哪些真实样例和具体标准判断第一版可以验收？"
    ];
    if (!data.budget) questions.unshift("项目预算大概是多少？是否有必须控制的成本上限？");
    if (!data.deadline) questions.splice(data.budget ? 0 : 1, 0, "希望什么时候完成第一版？是否有不能延后的业务节点？");
    if (!data.other) questions.push("是否还有数据安全、部署环境、品牌规范或合规方面的限制？");

    const budgetText = data.budget
      ? `已提供的预算信息为“${data.budget}”。`
      : "预算尚未提供，需要在下一次沟通中确认。";
    const deadlineText = data.deadline
      ? `已提供的交付时间为“${data.deadline}”。`
      : "交付时间尚未提供，需要在下一次沟通中确认。";

    return normalizeAiResult({
      summary: `项目“${data.name}”属于${data.industry}领域，目标客户是${data.audience}。客户当前想解决的问题是：${data.problem}。已提出的智能化支持方向是：${data.aiGoal}。${budgetText}${deadlineText}`,
      deliverables,
      steps: [
        { name: "确认目标与范围", description: `围绕“${data.problem}”确认问题优先级，并划定第一版包含与不包含的内容。` },
        { name: "盘点资料与环境", description: "确认所需资料、数据来源、现有系统、使用角色以及可用权限。" },
        { name: "设计方案原型", description: `把“${data.aiGoal}”拆成清晰的页面、流程、输入、输出和人工确认点。` },
        { name: "完成核心实现", description: "按照已确认的范围完成首版功能，并记录尚待确认的限制条件。" },
        { name: "使用样例测试", description: "用客户提供的真实样例验证结果、错误提示、边界场景和操作流程。" },
        { name: "客户验收与交付", description: "依据确认后的验收标准完成修订，交付使用说明并确认后续维护方式。" }
      ],
      questions
    });
  }

  function readProjects(storage) {
    if (!storage || typeof storage.getItem !== "function") {
      throw new Error("浏览器存储不可用");
    }
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("项目数据格式错误");
    return parsed.filter((project) => project && typeof project === "object" && project.id);
  }

  function writeProjects(storage, projects) {
    if (!storage || typeof storage.setItem !== "function") {
      throw new Error("浏览器存储不可用");
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  function upsertProject(projects, project) {
    const list = Array.isArray(projects) ? projects.slice() : [];
    const index = list.findIndex((item) => item.id === project.id);
    if (index === -1) list.push(project);
    else list[index] = project;
    return list;
  }

  function removeProject(projects, id) {
    return (Array.isArray(projects) ? projects : []).filter((project) => project.id !== id);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  return {
    STORAGE_KEY,
    PROJECT_STATUSES,
    REQUIRED_FIELDS,
    sanitizeFormData,
    validateRequired,
    createProjectId,
    normalizeAiResult,
    createLocalDemoPlan,
    readProjects,
    writeProjects,
    upsertProject,
    removeProject,
    formatDateTime
  };
});
