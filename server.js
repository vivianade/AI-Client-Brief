"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeAiResult, sanitizeFormData, validateRequired } = require("./core.js");

const root = __dirname;
const allowedFiles = new Set(["index.html", "styles.css", "core.js", "app.js"]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    clientInsight: { type: "string", minLength: 1 },
    coreProblem: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    solution: { type: "string", minLength: 1 },
    deliverables: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 }
        },
        required: ["name", "description"]
      }
    },
    questions: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    difficulty: { type: "string", enum: ["Low", "Medium", "High"] },
    aiOpportunities: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "clientInsight",
    "coreProblem",
    "summary",
    "solution",
    "deliverables",
    "steps",
    "questions",
    "difficulty",
    "aiOpportunities"
  ]
};

function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return target;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (target[key] === undefined) target[key] = value;
  }
  return target;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, { error: { code, message } });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("REQUEST_TOO_LARGE");
        error.code = "REQUEST_TOO_LARGE";
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_) {
        const error = new Error("INVALID_JSON");
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const texts = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content && content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  return texts.join("\n");
}

function buildAiRequest(brief, model) {
  return {
    model,
    instructions: [
      "你是一名资深 AI 项目顾问。根据客户需求生成务实、具体、可执行的中文项目方案。",
      "不要假设客户未提供的信息；把关键缺口放入 questions。",
      "区分客户表面诉求和真正要解决的业务问题。",
      "deliverables 应描述清晰的交付物，steps 应按执行顺序排列。",
      "保持简洁：deliverables 3-5 项，steps 4-6 项，questions 3-6 项，aiOpportunities 3-5 项，每项只写一个重点。",
      "difficulty 只能是 Low、Medium 或 High；所有其他字段使用中文。"
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `请根据以下客户需求生成初步项目方案：\n${JSON.stringify(brief, null, 2)}`
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "client_brief_plan",
        description: "客户需求初步项目方案",
        strict: true,
        schema: planSchema
      }
    },
    reasoning: { effort: "low" },
    store: false,
    max_output_tokens: 3200
  };
}

function buildChatRequest(brief, model) {
  const instructions = [
    "你是一名资深 AI 项目顾问。根据客户需求生成务实、具体、可执行的中文项目方案。",
    "只返回一个 JSON 对象，不要使用 Markdown，不要添加 JSON 之外的文字。",
    "必须包含 clientInsight、coreProblem、summary、solution、deliverables、steps、questions、difficulty、aiOpportunities。",
    "steps 中每项必须包含 name 和 description。",
    "difficulty 只能是 Low、Medium 或 High。",
    "deliverables 3-5 项，steps 4-6 项，questions 3-6 项，aiOpportunities 3-5 项。"
  ].join("\n");

  return {
    model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: `客户需求：\n${JSON.stringify(brief, null, 2)}` }
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "low",
    store: false
  };
}

async function generateWithAi(brief, options) {
  const { env, fetchImpl, timeoutMs } = options;
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("AI 尚未配置。请在 .env 文件中填写 AI_API_KEY，然后重启服务。");
    error.statusCode = 503;
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  const model = env.AI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (env.AI_API_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiMode = env.AI_API_MODE === "chat" ? "chat" : "responses";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let upstream;
  try {
    upstream = await fetchImpl(`${baseUrl}/${apiMode === "chat" ? "chat/completions" : "responses"}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(apiMode === "chat" ? buildChatRequest(brief, model) : buildAiRequest(brief, model)),
      signal: controller.signal
    });
  } catch (error) {
    const wrapped = new Error(
      error && error.name === "AbortError"
        ? "AI 服务响应超时，请稍后重试。"
        : "暂时无法连接 AI 服务，请检查网络后重试。"
    );
    wrapped.statusCode = error && error.name === "AbortError" ? 504 : 502;
    wrapped.code = error && error.name === "AbortError" ? "AI_TIMEOUT" : "AI_UNAVAILABLE";
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    let upstreamError = {};
    try {
      upstreamError = await upstream.json();
    } catch (_) {
      // The public response deliberately does not expose upstream details.
    }

    const error = new Error(
      upstream.status === 401
        ? "AI 服务配置无效，请联系管理员检查 API Key。"
        : upstream.status === 429
          ? "AI 服务当前繁忙或额度不足，请稍后重试。"
          : "AI 服务调用失败，请稍后重试。"
    );
    error.statusCode = upstream.status === 429 ? 429 : 502;
    error.code = upstream.status === 401 ? "AI_AUTH_ERROR" : upstream.status === 429 ? "AI_RATE_LIMITED" : "AI_UPSTREAM_ERROR";
    error.upstreamMessage = upstreamError && upstreamError.error && upstreamError.error.message;
    throw error;
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (_) {
    const error = new Error("AI 返回了无法识别的响应，请稍后重试。");
    error.statusCode = 502;
    error.code = "AI_INVALID_RESPONSE";
    throw error;
  }
  const outputText = apiMode === "chat"
    ? payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content
    : extractOutputText(payload);
  if (!outputText) {
    const error = new Error("AI 未返回可用方案，请重试。若问题持续，请联系管理员。");
    error.statusCode = 502;
    error.code = "AI_EMPTY_RESPONSE";
    throw error;
  }

  try {
    return normalizeAiResult(outputText);
  } catch (validationError) {
    const error = new Error("AI 返回的方案格式不完整，请重新生成。");
    error.statusCode = 502;
    error.code = "AI_INVALID_RESPONSE";
    error.upstreamMessage = [
      validationError && validationError.message,
      `status=${payload.status || "unknown"}`,
      `length=${outputText.length}`,
      `start=${JSON.stringify(outputText.slice(0, 1))}`,
      `end=${JSON.stringify(outputText.slice(-1))}`,
      payload.incomplete_details ? `incomplete=${JSON.stringify(payload.incomplete_details)}` : ""
    ].filter(Boolean).join("; ");
    throw error;
  }
}

function createServer(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || console;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  return http.createServer(async (request, response) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch (_) {
      response.writeHead(400).end("Bad Request");
      return;
    }

    if (requestPath === "/api/generate") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendError(response, 405, "METHOD_NOT_ALLOWED", "该接口仅支持 POST 请求。");
        return;
      }

      try {
        const rawBody = await readJsonBody(request);
        const brief = sanitizeFormData(rawBody);
        const validation = validateRequired(brief);
        if (!validation.valid) {
          sendError(response, 400, "VALIDATION_ERROR", validation.message);
          return;
        }

        const result = await generateWithAi(brief, { env, fetchImpl, timeoutMs });
        sendJson(response, 200, result);
      } catch (error) {
        if (error.code === "INVALID_JSON") {
          sendError(response, 400, "INVALID_JSON", "请求内容不是有效的 JSON。");
          return;
        }
        if (error.code === "REQUEST_TOO_LARGE") {
          if (!response.headersSent) sendError(response, 413, "REQUEST_TOO_LARGE", "提交的客户需求内容过长。");
          return;
        }

        logger.error("AI plan generation failed", {
          code: error.code,
          statusCode: error.statusCode,
          upstreamMessage: error.upstreamMessage
        });
        if (!response.headersSent) {
          sendError(response, error.statusCode || 500, error.code || "INTERNAL_ERROR", error.message || "服务器处理失败，请稍后重试。");
        }
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
      return;
    }

    const filename = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    if (!allowedFiles.has(filename)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
      return;
    }

    fs.readFile(path.join(root, filename), (error, data) => {
      if (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Server Error");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(request.method === "HEAD" ? undefined : data);
    });
  });
}

if (require.main === module) {
  loadEnvFile(path.join(root, ".env"));
  const port = Number(process.argv[2]) || Number(process.env.PORT) || 4173;
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`AI Client Brief V2 running at http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer, extractOutputText, buildAiRequest, buildChatRequest, loadEnvFile, planSchema };
