(function () {
  "use strict";

  const {
    PROJECT_STATUSES,
    sanitizeFormData,
    validateRequired,
    createProjectId,
    normalizeAiResult,
    readProjects,
    writeProjects,
    upsertProject,
    removeProject,
    formatDateTime
  } = window.AppCore;

  const el = {
    workspaceView: document.getElementById("workspace-view"),
    historyView: document.getElementById("history-view"),
    detailView: document.getElementById("detail-view"),
    brandHome: document.getElementById("brand-home"),
    historyButton: document.getElementById("history-button"),
    historyCount: document.getElementById("history-count"),
    newProjectButton: document.getElementById("new-project-button"),
    historyNewProjectButton: document.getElementById("history-new-project-button"),
    emptyNewProjectButton: document.getElementById("empty-new-project-button"),
    mobileMenuButton: document.getElementById("mobile-menu-button"),
    mobileProjectsButton: document.getElementById("mobile-projects-button"),
    sidebar: document.getElementById("app-sidebar"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),
    settingsButton: document.getElementById("settings-button"),
    wizardPanels: document.querySelectorAll("[data-wizard-step]"),
    flowItems: document.querySelectorAll("[data-flow-step]"),
    workspaceStepButtons: document.querySelectorAll("[data-workspace-step]"),
    workspaceTargetButtons: document.querySelectorAll("[data-workspace-target]"),
    backHistoryButtons: document.querySelectorAll(".back-history-button"),
    form: document.getElementById("brief-form"),
    status: document.getElementById("project-status"),
    workspaceKicker: document.getElementById("workspace-kicker"),
    workspaceTitle: document.getElementById("workspace-title"),
    formAlert: document.getElementById("form-alert"),
    generateButton: document.getElementById("generate-button"),
    generateLabel: document.querySelector("#generate-button .button-label"),
    saveButton: document.getElementById("save-button"),
    saveNote: document.getElementById("save-note"),
    resultPanel: document.querySelector(".result-panel"),
    resultStatus: document.getElementById("result-status"),
    resultEmpty: document.getElementById("result-empty"),
    resultLoading: document.getElementById("result-loading"),
    resultError: document.getElementById("result-error"),
    resultErrorDetail: document.getElementById("result-error-detail"),
    resultContent: document.getElementById("result-content"),
    resultModules: document.getElementById("result-modules"),
    retryButton: document.getElementById("retry-button"),
    resultSaveButton: document.getElementById("result-save-button"),
    resultRetryButton: document.getElementById("result-retry-button"),
    editRequirementsButton: document.getElementById("edit-requirements-button"),
    resultProjectName: document.getElementById("result-project-name"),
    summaryName: document.getElementById("summary-name"),
    summaryIndustry: document.getElementById("summary-industry"),
    summaryProblem: document.getElementById("summary-problem"),
    summaryAudience: document.getElementById("summary-audience"),
    summaryAiGoal: document.getElementById("summary-ai-goal"),
    problemHelpToggle: document.getElementById("problem-help-toggle"),
    problemExamples: document.getElementById("problem-examples"),
    historyEmpty: document.getElementById("history-empty"),
    historyList: document.getElementById("history-list"),
    historySearch: document.getElementById("history-search"),
    detailContent: document.getElementById("detail-content"),
    detailBackButton: document.getElementById("detail-back-button"),
    detailEditButton: document.getElementById("detail-edit-button"),
    detailDeleteButton: document.getElementById("detail-delete-button"),
    confirmModal: document.getElementById("confirm-modal"),
    confirmCancel: document.getElementById("confirm-cancel"),
    confirmDelete: document.getElementById("confirm-delete"),
    storageAlert: document.getElementById("storage-alert"),
    storageAlertText: document.getElementById("storage-alert-text"),
    dismissStorageAlert: document.getElementById("dismiss-storage-alert"),
    toastRegion: document.getElementById("toast-region")
  };

  let projects = [];
  let storageAvailable = true;
  let currentProjectId = null;
  let detailProjectId = null;
  let pendingDeleteId = null;
  let currentResult = null;
  let lastGeneratedSignature = "";
  let isGenerating = false;
  let lastFocusedElement = null;
  let currentWizardStep = 1;

  const STATUS_LABELS = {
    "待沟通": "需求收集",
    "方案中": "需求分析",
    "方案完成": "方案完成",
    "执行中": "项目进行中",
    "已完成": "已完成"
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "需求收集";
  }

  function setFlowStep(step) {
    el.flowItems.forEach((item) => {
      const itemStep = Number(item.dataset.flowStep);
      item.classList.toggle("is-active", itemStep === step);
      item.classList.toggle("is-complete", itemStep < step);
      const marker = item.querySelector("span");
      if (marker) marker.textContent = itemStep < step ? "✓" : String(itemStep);
    });

    el.workspaceStepButtons.forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.workspaceStep) === step);
    });
    el.workspaceTargetButtons.forEach((button) => button.classList.remove("is-active"));
  }

  function updateSummary() {
    const data = getFormData();
    el.summaryName.textContent = data.name || "尚未填写";
    el.summaryIndustry.textContent = data.industry || "尚未填写";
    el.summaryProblem.textContent = data.problem || "尚未填写";
    el.summaryAudience.textContent = data.audience || "尚未填写";
    el.summaryAiGoal.textContent = data.aiGoal || "尚未填写";
  }

  function showWizardStep(step, options = {}) {
    const nextStep = Math.min(5, Math.max(1, Number(step) || 1));
    currentWizardStep = nextStep;
    el.wizardPanels.forEach((panel) => {
      const active = Number(panel.dataset.wizardStep) === nextStep;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    setFlowStep(nextStep);
    if (nextStep === 5) updateSummary();
    if (options.scroll !== false) {
      document.querySelector(".brief-composer")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function stepForField(field) {
    if (["name", "industry"].includes(field)) return 1;
    if (field === "problem") return 2;
    if (["audience", "aiGoal"].includes(field)) return 3;
    return 4;
  }

  function validateWizardStep(step) {
    const data = getFormData();
    const fieldsByStep = {
      1: [["name", "请填写项目名称 / 客户名称"], ["industry", "请填写客户行业"]],
      2: [["problem", "请填写客户想解决的问题"]],
      3: [["audience", "请填写目标客户"], ["aiGoal", "请填写希望 AI 帮助完成什么"]]
    };
    const missing = (fieldsByStep[step] || []).find(([field]) => !data[field]);
    if (!missing) return true;
    showValidationError({ valid: false, field: missing[0], message: missing[1] });
    return false;
  }

  function moveToWizardStep(step) {
    const target = Number(step);
    if (target > currentWizardStep) {
      for (let value = currentWizardStep; value < target; value += 1) {
        if (!validateWizardStep(value)) return;
      }
    }
    clearValidation();
    showWizardStep(target);
  }

  function closeSidebar() {
    el.sidebar.classList.remove("is-open");
    el.sidebarBackdrop.hidden = true;
    el.mobileMenuButton.setAttribute("aria-expanded", "false");
  }

  function initializeStorage() {
    try {
      const probeKey = "__ai_client_brief_storage_probe__";
      localStorage.setItem(probeKey, "1");
      localStorage.removeItem(probeKey);
      projects = readProjects(localStorage);
    } catch (error) {
      projects = [];
      storageAvailable = false;
      showStorageError("浏览器存储不可用或项目数据读取失败，当前内容将无法持久保存。");
      console.error("Failed to initialize localStorage", error);
    }
    updateHistoryCount();
  }

  function showStorageError(message) {
    el.storageAlertText.textContent = message;
    el.storageAlert.hidden = false;
  }

  function getFormData() {
    const raw = Object.fromEntries(new FormData(el.form).entries());
    raw.status = el.status.value;
    return sanitizeFormData(raw);
  }

  function setFormData(project) {
    const data = sanitizeFormData(project);
    Object.entries(data).forEach(([key, value]) => {
      const field = key === "status" ? el.status : el.form.elements.namedItem(key);
      if (field) field.value = value;
    });
  }

  function inputSignature(data) {
    const { status, ...brief } = sanitizeFormData(data);
    return JSON.stringify(brief);
  }

  function clearValidation() {
    el.formAlert.hidden = true;
    el.formAlert.textContent = "";
    document.querySelectorAll(".field.has-error").forEach((field) => field.classList.remove("has-error"));
    document.querySelectorAll(".field-error").forEach((error) => { error.textContent = ""; });
  }

  function showValidationError(validation) {
    clearValidation();
    const targetStep = stepForField(validation.field);
    if (currentWizardStep !== targetStep) showWizardStep(targetStep, { scroll: false });
    el.formAlert.textContent = validation.message;
    el.formAlert.hidden = false;

    const input = el.form.elements.namedItem(validation.field);
    if (input) {
      const field = input.closest(".field");
      const error = document.querySelector(`[data-error-for="${validation.field}"]`);
      if (field) field.classList.add("has-error");
      if (error) error.textContent = validation.message;
      input.focus();
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function setView(name) {
    el.workspaceView.hidden = name !== "workspace";
    el.historyView.hidden = name !== "history";
    el.detailView.hidden = name !== "detail";
    el.historyButton.classList.toggle("is-active", name === "history");
    if (name !== "workspace") {
      el.workspaceStepButtons.forEach((button) => button.classList.remove("is-active"));
      el.workspaceTargetButtons.forEach((button) => button.classList.remove("is-active"));
    }
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function startNewProject() {
    currentProjectId = null;
    detailProjectId = null;
    currentResult = null;
    lastGeneratedSignature = "";
    el.form.reset();
    el.status.value = PROJECT_STATUSES[0];
    clearValidation();
    el.workspaceKicker.textContent = "创建项目";
    el.workspaceTitle.textContent = "新建项目";
    el.generateLabel.textContent = "AI 智能分析";
    el.saveButton.textContent = "暂存项目";
    el.saveNote.textContent = "";
    el.backHistoryButtons.forEach((button) => { button.hidden = true; });
    showResultState("empty");
    setView("workspace");
    showWizardStep(1, { scroll: false });
    updateSummary();
  }

  function editProject(id) {
    const project = projects.find((item) => item.id === id);
    if (!project) {
      showToast("未找到该项目，可能已被删除。");
      showHistory();
      return;
    }

    currentProjectId = id;
    detailProjectId = id;
    currentResult = safeStoredResult(project);
    setFormData(project);
    clearValidation();
    el.workspaceKicker.textContent = "编辑项目";
    el.workspaceTitle.textContent = project.name || "未命名项目";
    el.generateLabel.textContent = currentResult ? "重新分析" : "AI 智能分析";
    el.saveButton.textContent = "保存修改";
    el.saveNote.textContent = "";
    el.backHistoryButtons.forEach((button) => { button.hidden = false; });

    if (currentResult) {
      lastGeneratedSignature = inputSignature(project);
      renderResult(currentResult, el.resultModules);
      showResultState("content");
      showWizardStep(5, { scroll: false });
    } else {
      lastGeneratedSignature = "";
      showResultState("empty");
      showWizardStep(1, { scroll: false });
    }
    setView("workspace");
  }

  function showResultState(state, detail) {
    el.resultPanel.hidden = state === "empty";
    el.resultEmpty.hidden = state !== "empty";
    el.resultLoading.hidden = state !== "loading";
    el.resultError.hidden = state !== "error";
    el.resultContent.hidden = state !== "content";
    if (state === "error") el.resultErrorDetail.textContent = detail || "AI 服务暂时不可用，请稍后再试。";
    if (state !== "empty") setFlowStep(5);
  }

  function setGenerating(value) {
    isGenerating = value;
    el.generateButton.disabled = value;
    el.retryButton.disabled = value;
    el.resultRetryButton.disabled = value;
    el.generateButton.classList.toggle("is-loading", value);
    el.form.setAttribute("aria-busy", String(value));
    el.generateLabel.textContent = value ? "AI 正在分析..." : currentResult ? "重新分析" : "AI 智能分析";
  }

  async function requestAiPlan(data) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error("服务器返回了无法识别的响应，请稍后重试。");
    }

    if (!response.ok) {
      throw new Error(payload && payload.error && payload.error.message
        ? payload.error.message
        : "AI 服务调用失败，请稍后重试。");
    }
    return normalizeAiResult(payload);
  }

  async function generatePlan() {
    if (isGenerating) return;
    const data = getFormData();
    const validation = validateRequired(data);
    if (!validation.valid) {
      showWizardStep(stepForField(validation.field), { scroll: false });
      showValidationError(validation);
      return;
    }

    clearValidation();
    setGenerating(true);
    showResultState("loading");
    el.resultProjectName.textContent = data.name || "AI 正在整理你的项目";
    el.resultStatus.hidden = true;
    el.resultLoading.scrollIntoView({ block: "center", behavior: "smooth" });

    try {
      currentResult = await requestAiPlan(data);
      lastGeneratedSignature = inputSignature(data);
      renderResult(currentResult, el.resultModules);
      showResultState("content");
      el.resultProjectName.textContent = data.name;
      el.resultStatus.textContent = "AI 已生成";
      el.resultStatus.hidden = false;
      el.resultPanel?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    } catch (error) {
      console.error("Failed to generate plan", error);
      showResultState("error", "AI 服务暂时不可用，请稍后再试。如果问题持续出现，请检查 AI 服务配置。");
    } finally {
      setGenerating(false);
    }
  }

  function normalizeStoredResult(project) {
    return normalizeAiResult({
      clientInsight: project.clientInsight,
      coreProblem: project.coreProblem,
      summary: project.summary,
      solution: project.solution,
      deliverables: project.deliverables,
      steps: project.steps,
      questions: project.questions,
      difficulty: project.difficulty,
      aiOpportunities: project.aiOpportunities
    });
  }

  function safeStoredResult(project) {
    if (!project || !project.summary) return null;
    try {
      return normalizeStoredResult(project);
    } catch (error) {
      console.warn("Saved AI result is invalid and will not be displayed", error);
      showStorageError("该项目中已保存的 AI 方案格式异常，客户需求仍可继续编辑并重新生成方案。");
      return null;
    }
  }

  function createTextElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function createModule(index, title, icon, className) {
    const section = document.createElement("section");
    section.className = `result-module${className ? ` ${className}` : ""}`;
    section.dataset.resultSection = String(index);
    const heading = document.createElement("div");
    heading.className = "module-title";
    heading.append(
      createTextElement("span", "module-icon", icon),
      createTextElement("h3", "", title)
    );
    section.append(heading);
    return section;
  }

  function difficultyInfo(value) {
    const key = String(value || "").toLowerCase();
    if (key === "low" || key.includes("简单")) {
      return { label: "简单", className: "difficulty-low", reason: "首版目标和交付范围相对清晰，适合快速验证。" };
    }
    if (key === "high" || key.includes("复杂")) {
      return { label: "复杂", className: "difficulty-high", reason: "涉及较多业务环节、资料或系统协作，需要进一步确认范围。" };
    }
    return { label: "中等", className: "difficulty-medium", reason: "需要梳理业务知识并验证 AI 输出，建议分阶段实施。" };
  }

  function renderResult(result, container) {
    container.replaceChildren();

    const overview = document.createElement("section");
    overview.className = "analysis-overview";

    const problemOverview = document.createElement("article");
    problemOverview.className = "overview-card overview-problem";
    problemOverview.append(
      createTextElement("span", "overview-label", "🎯 客户真正的问题"),
      createTextElement("p", "", result.coreProblem)
    );

    const needsOverview = document.createElement("article");
    needsOverview.className = "overview-card overview-needs";
    needsOverview.append(createTextElement("span", "overview-label", "🏷 关键需求"));
    const needs = document.createElement("ul");
    needs.className = "tag-list";
    result.deliverables.slice(0, 4).forEach((item) => needs.append(createTextElement("li", "", item)));
    needsOverview.append(needs);

    const gapsOverview = document.createElement("article");
    gapsOverview.className = "overview-card overview-gaps";
    gapsOverview.append(createTextElement("span", "overview-label", "⚠ 信息缺口"));
    const gaps = document.createElement("ul");
    gaps.className = "compact-question-list";
    result.questions.slice(0, 3).forEach((item) => gaps.append(createTextElement("li", "", item)));
    gapsOverview.append(gaps);
    overview.append(problemOverview, needsOverview, gapsOverview);
    container.append(overview);

    const insight = createModule(1, "客户真正想解决的问题", "🎯");
    insight.append(
      createTextElement("p", "lead-text", result.coreProblem),
      createTextElement("p", "insight-note", result.clientInsight)
    );

    const summary = createModule(2, "客户需求摘要", "📋");
    summary.append(createTextElement("p", "lead-text", result.summary));

    const solution = createModule(3, "推荐解决方案", "💡");
    const solutionGrid = document.createElement("div");
    solutionGrid.className = "solution-grid";
    const solutionPlan = document.createElement("div");
    solutionPlan.append(createTextElement("strong", "", "建议做什么"), createTextElement("p", "", result.solution));
    const solutionReason = document.createElement("div");
    solutionReason.append(createTextElement("strong", "", "为什么这样做"), createTextElement("p", "", result.clientInsight));
    solutionGrid.append(solutionPlan, solutionReason);
    solution.append(solutionGrid);

    const deliverables = createModule(4, "建议交付内容", "📦");
    const deliverableList = document.createElement("ul");
    deliverableList.className = "tag-list deliverable-list";
    result.deliverables.forEach((item) => deliverableList.append(createTextElement("li", "", item)));
    deliverables.append(deliverableList);

    const steps = createModule(5, "项目执行步骤", "🚀", "is-wide");
    const stepList = document.createElement("ol");
    stepList.className = "step-list";
    result.steps.forEach((step) => {
      const item = document.createElement("li");
      item.append(
        createTextElement("strong", "", step.name),
        createTextElement("p", "", step.description)
      );
      stepList.append(item);
    });
    steps.append(stepList);

    const questions = createModule(6, "还需要向客户确认", "⚠️", "is-wide is-important");
    const questionList = document.createElement("ol");
    questionList.className = "question-list";
    result.questions.forEach((item) => questionList.append(createTextElement("li", "", item)));
    questions.append(questionList);

    const difficulty = createModule(7, "项目难度", "📊");
    const difficultyValue = difficultyInfo(result.difficulty);
    const difficultyBox = document.createElement("div");
    difficultyBox.className = `difficulty-box ${difficultyValue.className}`;
    const difficultyText = document.createElement("div");
    difficultyText.append(
      createTextElement("strong", "", difficultyValue.label),
      createTextElement("p", "", `判断依据：${difficultyValue.reason}`),
      createTextElement("small", "", "这是 AI 根据当前信息做出的初步判断。")
    );
    difficultyBox.append(createTextElement("span", "difficulty-dot", ""), difficultyText);
    difficulty.append(difficultyBox);

    const opportunities = createModule(8, "AI 可以承担哪些工作", "🤖");
    const opportunityList = document.createElement("ul");
    opportunityList.className = "opportunity-list";
    result.aiOpportunities.forEach((item) => opportunityList.append(createTextElement("li", "", item)));
    opportunities.append(opportunityList);

    [insight, summary, solution, deliverables, steps, questions, difficulty, opportunities].forEach((module, index) => {
      module.style.setProperty("--reveal-delay", `${index * 55}ms`);
      container.append(module);
    });
  }

  function saveCurrentProject() {
    const data = getFormData();
    if (!data.name) {
      showValidationError({ valid: false, field: "name", message: "请填写项目名称 / 客户名称" });
      return;
    }
    if (!storageAvailable) {
      showStorageError("浏览器存储不可用，无法保存项目。请检查浏览器隐私设置或存储权限。");
      showToast("项目保存失败。");
      return;
    }

    const now = new Date().toISOString();
    const existing = currentProjectId ? projects.find((item) => item.id === currentProjectId) : null;
    const result = currentResult || {
      clientInsight: "",
      coreProblem: "",
      summary: "",
      solution: "",
      deliverables: [],
      steps: [],
      questions: [],
      difficulty: "",
      aiOpportunities: []
    };
    const project = {
      id: existing ? existing.id : createProjectId(),
      ...data,
      clientInsight: result.clientInsight,
      coreProblem: result.coreProblem,
      summary: result.summary,
      solution: result.solution,
      deliverables: result.deliverables,
      steps: result.steps,
      questions: result.questions,
      difficulty: result.difficulty,
      aiOpportunities: result.aiOpportunities,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };

    try {
      const nextProjects = upsertProject(projects, project);
      writeProjects(localStorage, nextProjects);
      projects = nextProjects;
      currentProjectId = project.id;
      detailProjectId = project.id;
      updateHistoryCount();
      el.workspaceKicker.textContent = "编辑项目";
      el.workspaceTitle.textContent = project.name;
      el.resultProjectName.textContent = project.name;
      el.saveButton.textContent = "保存修改";
      el.backHistoryButtons.forEach((button) => { button.hidden = false; });
      el.saveNote.textContent = `已更新 ${formatDateTime(now)}`;
      showToast("项目已保存。");
    } catch (error) {
      console.error("Failed to save project", error);
      storageAvailable = false;
      showStorageError("浏览器存储写入失败，项目未保存。请检查可用空间或存储权限。");
      showToast("项目保存失败。");
    }
  }

  function updateHistoryCount() {
    el.historyCount.textContent = String(projects.length);
    el.historyCount.setAttribute("aria-label", `共 ${projects.length} 个项目`);
  }

  function statusClass(status) {
    return {
      "待沟通": "status-waiting",
      "方案中": "status-planning",
      "方案完成": "status-ready",
      "执行中": "status-active",
      "已完成": "status-done"
    }[status] || "status-waiting";
  }

  function createStatusSelect(project) {
    const select = document.createElement("select");
    select.className = "history-status-select";
    select.dataset.projectId = project.id;
    select.setAttribute("aria-label", `修改 ${project.name || "未命名项目"} 的状态`);
    PROJECT_STATUSES.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = statusLabel(value);
      option.selected = value === project.status;
      select.append(option);
    });
    return select;
  }

  function updateProjectStatus(id, status) {
    const project = projects.find((item) => item.id === id);
    if (!project || !PROJECT_STATUSES.includes(status) || !storageAvailable) return;
    const updatedProject = { ...project, status, updatedAt: new Date().toISOString() };
    try {
      projects = upsertProject(projects, updatedProject);
      writeProjects(localStorage, projects);
      renderHistory();
      showToast(`项目状态已更新为“${statusLabel(status)}”。`);
    } catch (error) {
      console.error("Failed to update project status", error);
      showStorageError("项目状态保存失败，请检查浏览器存储设置。");
    }
  }

  function showHistory() {
    el.historySearch.value = "";
    renderHistory();
    setView("history");
  }

  function openResultArea(target) {
    setView("workspace");
    if (!currentResult) {
      moveToWizardStep(5);
      return;
    }
    el.workspaceStepButtons.forEach((button) => button.classList.remove("is-active"));
    el.workspaceTargetButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.workspaceTarget === target);
    });
    const destination = target === "questions"
      ? el.resultModules.querySelector('[data-result-section="6"]')
      : el.resultPanel;
    destination?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function renderHistory() {
    el.historyList.replaceChildren();
    const query = el.historySearch.value.trim().toLowerCase();
    const sorted = projects
      .filter((project) => !query || [project.name, project.industry, statusLabel(project.status)]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    el.historyEmpty.hidden = projects.length !== 0;

    if (projects.length && !sorted.length) {
      el.historyList.append(createTextElement("p", "history-no-results", "没有找到匹配的项目，请尝试其他关键词。"));
      return;
    }

    sorted.forEach((project) => {
      const card = document.createElement("article");
      card.className = "history-card";
      card.dataset.projectId = project.id;

      const main = document.createElement("div");
      main.className = "history-main";
      const titleButton = createTextElement("button", "", project.name || "未命名项目");
      titleButton.type = "button";
      titleButton.dataset.action = "view";
      titleButton.dataset.id = project.id;
      main.append(titleButton, createTextElement("p", "", project.summary ? "已有初步方案" : "尚未生成方案"));

      const industry = createTextElement("div", "history-industry", project.industry || "行业未填写");
      const status = document.createElement("div");
      status.className = "history-status-control";
      status.append(
        createTextElement("span", `status-badge ${statusClass(project.status)}`, statusLabel(project.status)),
        createStatusSelect(project)
      );
      const updated = document.createElement("div");
      updated.className = "history-updated";
      updated.append(
        createTextElement("small", "", "最后更新时间"),
        document.createTextNode(formatDateTime(project.updatedAt))
      );

      const actions = document.createElement("div");
      actions.className = "history-card-actions";
      [
        ["查看", "view", ""],
        ["编辑", "edit", ""],
        ["删除", "delete", "delete-link"]
      ].forEach(([label, action, className]) => {
        const button = createTextElement("button", className, label);
        button.type = "button";
        button.dataset.action = action;
        button.dataset.id = project.id;
        actions.append(button);
      });

      card.append(main, industry, status, updated, actions);
      el.historyList.append(card);
    });
  }

  function showProjectDetail(id) {
    const project = projects.find((item) => item.id === id);
    if (!project) {
      showToast("未找到该项目，可能已被删除。");
      showHistory();
      return;
    }

    detailProjectId = id;
    el.detailContent.replaceChildren();
    const sheet = document.createElement("div");
    sheet.className = "detail-sheet";

    const hero = document.createElement("header");
    hero.className = "detail-hero";
    const heroMain = document.createElement("div");
    heroMain.append(
      createTextElement("span", `status-badge ${statusClass(project.status)}`, statusLabel(project.status)),
      createTextElement("h1", "", project.name || "未命名项目"),
      createTextElement("p", "", project.industry || "行业未填写")
    );
    const time = document.createElement("div");
    time.className = "detail-time";
    time.append(
      createTextElement("span", "", `创建：${formatDateTime(project.createdAt)}`),
      createTextElement("span", "", `更新：${formatDateTime(project.updatedAt)}`)
    );
    hero.append(heroMain, time);

    const briefSection = document.createElement("section");
    briefSection.className = "detail-section";
    briefSection.append(createTextElement("h2", "", "客户需求"));
    const fields = document.createElement("dl");
    fields.className = "detail-fields";
    [
      ["客户想解决的问题", project.problem, true],
      ["目标客户", project.audience, false],
      ["希望 AI 帮助完成什么", project.aiGoal, true],
      ["预算", project.budget || "尚未提供", false],
      ["交付时间", project.deadline || "尚未提供", false],
      ["其他要求", project.other || "尚未提供", true]
    ].forEach(([label, value, full]) => {
      const item = document.createElement("div");
      item.className = `detail-field${full ? " full" : ""}`;
      item.append(createTextElement("dt", "", label), createTextElement("dd", "", value || "尚未提供"));
      fields.append(item);
    });
    briefSection.append(fields);

    const resultSection = document.createElement("section");
    resultSection.className = "detail-section";
    resultSection.append(createTextElement("h2", "", "初步项目方案"));
    const storedResult = safeStoredResult(project);
    if (storedResult) {
      resultSection.append(createTextElement(
        "div",
        "fixed-notice detail-result",
        "以下为 AI 根据当前信息生成的初步项目方案，部分信息尚未确认，请结合“还需要向客户确认”的问题进一步沟通。"
      ));
      const resultContainer = document.createElement("div");
      resultContainer.className = "detail-result result-modules";
      renderResult(storedResult, resultContainer);
      resultSection.append(resultContainer);
    } else {
      resultSection.append(createTextElement("p", "no-result", "该项目尚未生成初步方案。"));
    }

    sheet.append(hero, briefSection, resultSection);
    el.detailContent.append(sheet);
    setView("detail");
  }

  function openDeleteConfirm(id) {
    if (!projects.some((project) => project.id === id)) return;
    pendingDeleteId = id;
    lastFocusedElement = document.activeElement;
    el.confirmModal.hidden = false;
    el.confirmCancel.focus();
  }

  function closeDeleteConfirm() {
    el.confirmModal.hidden = true;
    pendingDeleteId = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
  }

  function confirmDeleteProject() {
    if (!pendingDeleteId) return;
    if (!storageAvailable) {
      closeDeleteConfirm();
      showStorageError("浏览器存储不可用，无法删除项目。");
      return;
    }

    const deletedId = pendingDeleteId;
    try {
      const nextProjects = removeProject(projects, deletedId);
      writeProjects(localStorage, nextProjects);
      projects = nextProjects;
      updateHistoryCount();
      if (currentProjectId === deletedId) {
        currentProjectId = null;
        currentResult = null;
      }
      closeDeleteConfirm();
      showHistory();
      showToast("项目已删除。");
    } catch (error) {
      console.error("Failed to delete project", error);
      closeDeleteConfirm();
      showStorageError("浏览器存储写入失败，项目未能删除。");
    }
  }

  function showToast(message) {
    const toast = createTextElement("div", "toast", message);
    el.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function handleFormInput(event) {
    const input = event.target;
    if (input && input.name) {
      const field = input.closest(".field");
      const error = document.querySelector(`[data-error-for="${input.name}"]`);
      if (field) field.classList.remove("has-error");
      if (error) error.textContent = "";
      if (!document.querySelector(".field.has-error")) {
        el.formAlert.hidden = true;
        el.formAlert.textContent = "";
      }
    }

    el.saveNote.textContent = "";
    updateSummary();
    if (currentResult && lastGeneratedSignature && inputSignature(getFormData()) !== lastGeneratedSignature) {
      el.resultStatus.textContent = "需求已修改，请重新分析";
      el.resultStatus.hidden = false;
    } else if (currentResult) {
      el.resultStatus.textContent = "AI 已生成";
      el.resultStatus.hidden = false;
    }
  }

  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    generatePlan();
  });
  el.form.addEventListener("input", handleFormInput);
  el.status.addEventListener("change", () => { el.saveNote.textContent = ""; });
  el.retryButton.addEventListener("click", generatePlan);
  el.resultRetryButton.addEventListener("click", generatePlan);
  el.saveButton.addEventListener("click", saveCurrentProject);
  el.resultSaveButton.addEventListener("click", saveCurrentProject);
  el.editRequirementsButton.addEventListener("click", () => {
    showWizardStep(2);
    el.form.elements.namedItem("problem").focus({ preventScroll: true });
  });
  el.historyButton.addEventListener("click", showHistory);
  el.mobileProjectsButton.addEventListener("click", showHistory);
  el.brandHome.addEventListener("click", startNewProject);
  el.newProjectButton.addEventListener("click", startNewProject);
  el.historyNewProjectButton.addEventListener("click", startNewProject);
  el.emptyNewProjectButton.addEventListener("click", startNewProject);
  el.settingsButton.addEventListener("click", () => showToast("AI 服务配置请在项目的 .env 文件中修改。"));
  el.mobileMenuButton.addEventListener("click", () => {
    const open = !el.sidebar.classList.contains("is-open");
    el.sidebar.classList.toggle("is-open", open);
    el.sidebarBackdrop.hidden = !open;
    el.mobileMenuButton.setAttribute("aria-expanded", String(open));
  });
  el.sidebarBackdrop.addEventListener("click", closeSidebar);
  document.querySelectorAll("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => moveToWizardStep(button.dataset.nextStep));
  });
  document.querySelectorAll("[data-prev-step]").forEach((button) => {
    button.addEventListener("click", () => moveToWizardStep(button.dataset.prevStep));
  });
  el.flowItems.forEach((item) => {
    item.querySelector("button").addEventListener("click", () => moveToWizardStep(item.dataset.flowStep));
  });
  el.workspaceStepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setView("workspace");
      moveToWizardStep(button.dataset.workspaceStep);
    });
  });
  el.workspaceTargetButtons.forEach((button) => {
    button.addEventListener("click", () => openResultArea(button.dataset.workspaceTarget));
  });
  el.problemHelpToggle.addEventListener("click", () => {
    const expanded = el.problemHelpToggle.getAttribute("aria-expanded") === "true";
    el.problemHelpToggle.setAttribute("aria-expanded", String(!expanded));
    el.problemExamples.hidden = expanded;
  });
  el.problemExamples.addEventListener("click", (event) => {
    const example = event.target.closest("[data-problem-example]");
    if (!example) return;
    el.form.elements.namedItem("problem").value = example.dataset.problemExample;
    el.form.elements.namedItem("problem").dispatchEvent(new Event("input", { bubbles: true }));
  });
  el.historySearch.addEventListener("input", renderHistory);
  el.backHistoryButtons.forEach((button) => button.addEventListener("click", showHistory));
  el.detailBackButton.addEventListener("click", showHistory);
  el.detailEditButton.addEventListener("click", () => editProject(detailProjectId));
  el.detailDeleteButton.addEventListener("click", () => openDeleteConfirm(detailProjectId));
  el.confirmCancel.addEventListener("click", closeDeleteConfirm);
  el.confirmDelete.addEventListener("click", confirmDeleteProject);
  el.dismissStorageAlert.addEventListener("click", () => { el.storageAlert.hidden = true; });

  el.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "view") showProjectDetail(id);
    if (action === "edit") editProject(id);
    if (action === "delete") openDeleteConfirm(id);
  });

  el.historyList.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-project-id]");
    if (select) updateProjectStatus(select.dataset.projectId, select.value);
  });

  el.confirmModal.addEventListener("click", (event) => {
    if (event.target === el.confirmModal) closeDeleteConfirm();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!el.confirmModal.hidden) closeDeleteConfirm();
  });

  initializeStorage();
  startNewProject();
})();
