"use strict";

const { randomUUID } = require("node:crypto");
const { collectRequestBody } = require("./request-body");
const { sendJson } = require("./http-response");
const { createJsonResearchStore } = require("./research-store");
const { createLocalResearchFileStorage } = require("./research-file-storage");

const MAX_BODY_BYTES = 1024 * 1024;
const registryModule = import("./tools/registry.mjs");
const agentAdapterModule = import("./agent-tools/adapter.mjs");
const agentAuthModule = import("./agent-tools/auth.mjs");

function requestId(req) {
  const supplied = String(req.headers["x-request-id"] || "").trim();
  return /^[\w.:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
}

function readJson(req) {
  return new Promise((resolve, reject) => collectRequestBody(req, MAX_BODY_BYTES, ({ body, error, tooLarge }) => {
    if (error) reject(error);
    else if (tooLarge) reject(Object.assign(new Error("TOO_LARGE"), { code: "TOO_LARGE" }));
    else {
      try { resolve(JSON.parse(body.toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("INVALID_JSON"), { code: "INVALID_JSON" })); }
    }
  }));
}

function parsed(value) {
  try { return JSON.parse(String(value || "{}")); }
  catch { return {}; }
}

function publicToolResult(item) {
  if (!item) return null;
  return { id: item.id, project_id: item.project_id, tool_id: item.tool_id, input: parsed(item.input), result: parsed(item.result), source: item.source || "user", created_at: item.created_at };
}

function createToolHandler({ env = process.env, store = createJsonResearchStore(env), fileStorage = createLocalResearchFileStorage(env), logger = console } = {}) {
  const finish = (res, status, payload, id) => sendJson(res, status, payload, {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    "X-Tool-Request-ID": id,
  });
  return async function handleTools(req, res) {
    const id = requestId(req);
    const started = Date.now();
    let toolId = "registry";
    const log = (status, outcome, extra = {}) => logger.log(JSON.stringify({ event: "tool_gateway_api", request_id: id, tool_id: toolId, method: req.method, status, outcome, duration_ms: Date.now() - started, ...extra }));
    if (req.method === "OPTIONS") { finish(res, 204, null, id); return; }
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      const pathname = requestUrl.pathname.replace(/^\/api\/tools\/?/, "").replace(/\/+$/, "");
      const segments = pathname ? pathname.split("/").map((segment) => decodeURIComponent(segment)) : [];
      if (segments[0] === "agent" && segments.length === 2 && req.method === "POST") {
        toolId = String(segments[1] || "");
        const { verifyAgentToolCredential } = await agentAuthModule;
        if (!await verifyAgentToolCredential(req.headers.authorization, env.SURVEYKIT_TOOL_API_KEY)) {
          finish(res, 401, { success: false, tool: toolId, error: { code: "INVALID_INTERNAL_CREDENTIAL", message: "内部专业工具认证失败。", request_id: id } }, id); log(401, "error"); return;
        }
        const body = await readJson(req);
        const { executeAgentTool } = await agentAdapterModule;
        const executed = await executeAgentTool({ agentToolId: toolId, args: body.arguments, harnessSessionId: body.harness_session_id, callId: body.call_id, requestId: id, store, fileStorage, dataJobRunner: (options) => import("./data-jobs-local.mjs").then(({ runDataToolThread }) => runDataToolThread(options)), logger });
        finish(res, 200, { success: true, tool: toolId, data: executed.data, meta: { deterministic: true, uses_ai: false, project_saved: true, replayed: executed.replayed } }, id); return;
      }
      const userId = String(env.TOOL_DEV_USER_ID || env.RESEARCH_DEV_USER_ID || "").trim();
      if (!userId) { finish(res, 401, { success: false, tool: toolId, error: { code: "UNAUTHORIZED", message: "请先登录后再使用专业工具。", request_id: id } }, id); log(401, "error"); return; }
      const { executeTool, listTools } = await registryModule;
      if (!segments.length && req.method === "GET") {
        finish(res, 200, { success: true, tool: "registry", data: { tools: listTools() }, meta: { deterministic_only: true } }, id); log(200, "success"); return;
      }
      if (segments[0] === "results" && req.method === "GET") {
        const projectId = String(requestUrl.searchParams.get("project_id") || "").trim();
        if (!projectId) throw Object.assign(new Error("项目标识不能为空。"), { code: "INVALID_INPUT" });
        if (!await store.getProject(userId, projectId)) throw Object.assign(new Error("项目不存在。"), { code: "PROJECT_NOT_FOUND" });
        const results = (await store.listToolResults(projectId)).map(publicToolResult);
        finish(res, 200, { success: true, tool: "tool-results", data: { project_id: projectId, results }, meta: {} }, id); log(200, "success", { project_id: projectId }); return;
      }
      toolId = String(segments[0] || "");
      if (segments.length === 1 && req.method === "POST") {
        const body = await readJson(req);
        const input = body.input && typeof body.input === "object" ? body.input : body;
        const executed = executeTool(toolId, input);
        finish(res, 200, { success: true, tool: toolId, data: executed.data, meta: executed.meta }, id); log(200, "success"); return;
      }
      if (segments.length === 2 && segments[1] === "results" && req.method === "POST") {
        const body = await readJson(req);
        const projectId = String(body.project_id || "").trim();
        if (!projectId) throw Object.assign(new Error("项目标识不能为空。"), { code: "INVALID_INPUT" });
        if (!await store.getProject(userId, projectId)) throw Object.assign(new Error("项目不存在。"), { code: "PROJECT_NOT_FOUND" });
        const input = body.input && typeof body.input === "object" ? body.input : {};
        const executed = executeTool(toolId, input);
        const saved = await store.createToolResult(userId, projectId, toolId, input, executed.data);
        finish(res, 201, { success: true, tool: toolId, data: { tool_result: publicToolResult(saved) }, meta: { deterministic: true, uses_ai: false } }, id); log(201, "success", { project_id: projectId, tool_result_id: saved.id }); return;
      }
      finish(res, 404, { success: false, tool: toolId || "registry", error: { code: "NOT_FOUND", message: "接口不存在。", request_id: id } }, id); log(404, "error");
    } catch (error) {
      const code = String(error.code || "INTERNAL_ERROR");
      const status = Number(error.status) || (code === "PROJECT_NOT_FOUND" || code === "TOOL_NOT_FOUND" ? 404 : code === "TOO_LARGE" ? 413 : code === "INTERNAL_ERROR" ? 500 : 400);
      const message = status === 500 ? "专业工具暂时不可用，请稍后重试。" : error.message || "请求内容无效。";
      finish(res, status, { success: false, tool: toolId || "registry", error: { code, message, ...(error.details ? { details: error.details } : {}), request_id: id } }, id);
      log(status, "error", { error_type: code });
    }
  };
}

module.exports = { createToolHandler, publicToolResult };
