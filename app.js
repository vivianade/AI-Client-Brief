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
    resultStatus: document.getElementById("result-status"),
    resultEmpty: document.getElementById("result-empty"),
    resultLoading: document.getElementById("result-loading"),
    resultError: document.getElementById("result-error"),
    resultErrorDetail: document.getElementById("result-error-detail"),
    resultContent: document.getElementById("result-content"),
    resultModules: document.getElementById("result-modules"),
    retryButton: document.getElementById("retry-button"),
    historyEmpty: document.getElementById("history-empty"),
    historyList: document.getElementById("history-list"),
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
    el.workspaceKicker.textContent = "AI PROJECT INTELLIGENCE";
    el.workspaceTitle.textContent = "Turn an Idea Into an AI Plan";
    el.generateLabel.textContent = "Analyze with AI";
    el.saveButton.textContent = "Save project";
    el.saveNote.textContent = "";
    el.backHistoryButtons.forEach((button) => { button.hidden = true; });
    showResultState("empty");
    setView("workspace");
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
    el.workspaceKicker.textContent = "EDIT PROJECT";
    el.workspaceTitle.textContent = project.name || "未命名项目";
    el.generateLabel.textContent = currentResult ? "Analyze Again" : "Analyze with AI";
    el.saveButton.textContent = "Save changes";
    el.saveNote.textContent = "";
    el.backHistoryButtons.forEach((button) => { button.hidden = false; });

    if (currentResult) {
      lastGeneratedSignature = inputSignature(project);
      renderResult(currentResult, el.resultModules);
      showResultState("content");
    } else {
      lastGeneratedSignature = "";
      showResultState("empty");
    }
    setView("workspace");
  }

  function showResultState(state, detail) {
    el.resultEmpty.hidden = state !== "empty";
    el.resultLoading.hidden = state !== "loading";
    el.resultError.hidden = state !== "error";
    el.resultContent.hidden = state !== "content";
    if (state === "error") el.resultErrorDetail.textContent = detail || "";
  }

  function setGenerating(value) {
    isGenerating = value;
    el.generateButton.disabled = value;
    el.retryButton.disabled = value;
    el.generateButton.classList.toggle("is-loading", value);
    el.form.setAttribute("aria-busy", String(value));
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
      showValidationError(validation);
      return;
    }

    clearValidation();
    setGenerating(true);
    showResultState("loading");
    el.resultStatus.hidden = true;
    el.resultLoading.scrollIntoView({ block: "center", behavior: "smooth" });

    try {
      currentResult = await requestAiPlan(data);
      lastGeneratedSignature = inputSignature(data);
      renderResult(currentResult, el.resultModules);
      showResultState("content");
      el.resultStatus.textContent = "AI GENERATED";
      el.resultStatus.hidden = false;
      el.generateLabel.textContent = "Analyze Again";
    } catch (error) {
      console.error("Failed to generate plan", error);
      const detail = error && error.message ? error.message : "未知错误，请稍后重试。";
      showResultState("error", detail);
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

  function createModule(index, title) {
    const section = document.createElement("section");
    section.className = "result-module";
    const heading = document.createElement("div");
    heading.className = "module-title";
    heading.append(
      createTextElement("span", "module-index", String(index).padStart(2, "0")),
      createTextElement("h3", "", title)
    );
    section.append(heading);
    return section;
  }

  function renderResult(result, container) {
    container.replaceChildren();

    const insight = createModule(1, "Client Insight");
    const insightMeta = document.createElement("div");
    insightMeta.className = "insight-meta";
    insightMeta.append(
      createTextElement("span", "difficulty-label", "PROJECT DIFFICULTY"),
      createTextElement("span", `difficulty-badge difficulty-${result.difficulty.toLowerCase()}`, result.difficulty)
    );
    insight.append(
      createTextElement("p", "lead-text", result.clientInsight),
      createTextElement("p", "summary-text", result.summary),
      insightMeta
    );

    const problem = createModule(2, "Core Problem");
    problem.append(createTextElement("p", "lead-text", result.coreProblem));

    const solution = createModule(3, "AI Solution");
    solution.append(createTextElement("p", "lead-text", result.solution));

    const deliverables = createModule(4, "Deliverables");
    const deliverableList = document.createElement("ul");
    deliverableList.className = "deliverable-list";
    result.deliverables.forEach((item) => deliverableList.append(createTextElement("li", "", item)));
    deliverables.append(deliverableList);

    const steps = createModule(5, "Execution Plan");
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

    const questions = createModule(6, "Questions to Ask");
    const questionList = document.createElement("ol");
    questionList.className = "question-list";
    result.questions.forEach((item) => questionList.append(createTextElement("li", "", item)));
    questions.append(questionList);

    const opportunities = createModule(7, "AI Opportunities");
    const opportunityList = document.createElement("ul");
    opportunityList.className = "opportunity-list";
    result.aiOpportunities.forEach((item) => opportunityList.append(createTextElement("li", "", item)));
    opportunities.append(opportunityList);

    [insight, problem, solution, deliverables, steps, questions, opportunities].forEach((module, index) => {
      module.style.setProperty("--reveal-delay", `${index * 90}ms`);
      container.append(module);
    });
  }

  function saveCurrentProject() {
    const data = getFormData();
    if (!data.name) {
      showValidationError({ valid: false, field: "name", message: "请填写「项目 / 客户名称」。" });
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
      el.workspaceKicker.textContent = "EDIT PROJECT";
      el.workspaceTitle.textContent = project.name;
      el.saveButton.textContent = "Save changes";
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
      "执行中": "status-active",
      "已完成": "status-done"
    }[status] || "status-waiting";
  }

  function showHistory() {
    renderHistory();
    setView("history");
  }

  function renderHistory() {
    el.historyList.replaceChildren();
    const sorted = projects.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    el.historyEmpty.hidden = sorted.length !== 0;

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
      const status = createTextElement("span", `status-badge ${statusClass(project.status)}`, project.status || "待沟通");
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
      createTextElement("span", `status-badge ${statusClass(project.status)}`, project.status || "待沟通"),
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
        "以下方案由 AI 根据当前信息生成。请核对关键事实，并结合“向客户确认的问题”补充尚未明确的内容。"
      ));
      const resultContainer = document.createElement("div");
      resultContainer.className = "detail-result";
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
    if (currentResult && lastGeneratedSignature && inputSignature(getFormData()) !== lastGeneratedSignature) {
      el.resultStatus.textContent = "INPUT CHANGED · ANALYZE AGAIN";
      el.resultStatus.hidden = false;
    } else if (currentResult) {
      el.resultStatus.textContent = "AI GENERATED";
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
  el.saveButton.addEventListener("click", saveCurrentProject);
  el.historyButton.addEventListener("click", showHistory);
  el.brandHome.addEventListener("click", startNewProject);
  el.newProjectButton.addEventListener("click", startNewProject);
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
