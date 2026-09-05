import { executeTool, listTools } from "../../../lib/tools/registry.mjs";
import { executeAgentTool } from "../../../lib/agent-tools/adapter.mjs";
import { verifyAgentToolCredential } from "../../../lib/agent-tools/auth.mjs";
import { createResearchStore, resolveResearchIdentity } from "../research/[[path]].js";

const MAX_BODY = 1024 * 1024;
const clean = (value, maximum = 100_000) => String(value ?? "").trim().slice(0, maximum);
const requestId = (request) => {
  const supplied = clean(request.headers.get("X-Request-ID"), 128);
  return /^[\w.:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
};

function json(payload, status = 200, id = "") {
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    ...(id ? { "X-Tool-Request-ID": id } : {}),
  } });
}

function failure(tool, code, message, id, status = 400, details = null) {
  return json({ success: false, tool, error: { code, message, ...(details ? { details } : {}), request_id: id } }, status, id);
}

async function readBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) throw Object.assign(new Error("请求内容过大。"), { code: "TOO_LARGE" });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) throw Object.assign(new Error("请求内容过大。"), { code: "TOO_LARGE" });
  try { return JSON.parse(text || "{}"); }
  catch { throw Object.assign(new Error("JSON 格式无效。"), { code: "INVALID_JSON" }); }
}

function parsed(value) { try { return JSON.parse(String(value || "{}")); } catch { return {}; } }
function publicResult(item) { return { id: item.id, project_id: item.project_id, tool_id: item.tool_id, input: parsed(item.input), result: parsed(item.result), source: item.source || "user", created_at: item.created_at }; }
function dataStorage(env) { return {
  key: (projectId, itemId, extension) => `datasets/${encodeURIComponent(String(projectId))}/${String(itemId).replace(/[^a-zA-Z0-9_-]/g, "")}.${String(extension).replace(/[^a-z0-9]/gi, "")}`,
  get: async (key) => { const object = await env.RESEARCH_FILES.get(key); if (!object) throw Object.assign(new Error("数据集文件不存在。"), { code: "DATASET_FILE_NOT_FOUND" }); return new Uint8Array(await object.arrayBuffer()); },
  put: (key, bytes) => env.RESEARCH_FILES.put(key, bytes),
  delete: (key) => env.RESEARCH_FILES.delete(key),
}; }

export async function onRequest({ request, env }) {
  const id = requestId(request);
  let toolId = "registry";
  if (request.method === "OPTIONS") return json(null, 204, id);
  try {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\/api\/tools\/?/, "").replace(/\/+$/, "");
    const segments = pathname ? pathname.split("/").map((segment) => decodeURIComponent(segment)) : [];
    if (segments[0] === "agent" && segments.length === 2 && request.method === "POST") {
      toolId = clean(segments[1], 64);
      if (!await verifyAgentToolCredential(request.headers.get("Authorization"), env.SURVEYKIT_TOOL_API_KEY)) return failure(toolId, "INVALID_INTERNAL_CREDENTIAL", "内部专业工具认证失败。", id, 401);
      if (!env.RESEARCH_DB) return failure(toolId, "DATABASE_NOT_CONFIGURED", "专业工具项目存储尚未配置。", id, 503);
      if (["data_profile", "data_clean", "data_weight", "crosstab"].includes(toolId) && !env.RESEARCH_FILES) return failure(toolId, "DATA_STORAGE_NOT_CONFIGURED", "数据工具文件存储尚未配置。", id, 503);
      const payload = await readBody(request);
      const executed = await executeAgentTool({ agentToolId: toolId, args: payload.arguments, harnessSessionId: payload.harness_session_id, callId: payload.call_id, requestId: id, store: createResearchStore(env.RESEARCH_DB), fileStorage: env.RESEARCH_FILES ? dataStorage(env) : null, logger: console });
      return json({ success: true, tool: toolId, data: executed.data, meta: { deterministic: true, uses_ai: false, project_saved: true, replayed: executed.replayed } }, 200, id);
    }
    const userId = await resolveResearchIdentity(request, env);
    if (!userId) return failure(toolId, "UNAUTHORIZED", "请先登录后再使用专业工具。", id, 401);
    if (!segments.length && request.method === "GET") return json({ success: true, tool: "registry", data: { tools: listTools() }, meta: { deterministic_only: true } }, 200, id);
    if (segments[0] === "results" && request.method === "GET") {
      if (!env.RESEARCH_DB) return failure("tool-results", "DATABASE_NOT_CONFIGURED", "专业工具项目存储尚未配置。", id, 503);
      const repository = createResearchStore(env.RESEARCH_DB);
      const projectId = clean(url.searchParams.get("project_id"), 128);
      if (!projectId) return failure("tool-results", "INVALID_INPUT", "项目标识不能为空。", id);
      if (!await repository.getProject(userId, projectId)) return failure("tool-results", "PROJECT_NOT_FOUND", "项目不存在。", id, 404);
      return json({ success: true, tool: "tool-results", data: { project_id: projectId, results: (await repository.listToolResults(projectId)).map(publicResult) }, meta: {} }, 200, id);
    }
    toolId = clean(segments[0], 64);
    if (segments.length === 1 && request.method === "POST") {
      const payload = await readBody(request);
      const input = payload.input && typeof payload.input === "object" ? payload.input : payload;
      const executed = executeTool(toolId, input);
      return json({ success: true, tool: toolId, data: executed.data, meta: executed.meta }, 200, id);
    }
    if (segments.length === 2 && segments[1] === "results" && request.method === "POST") {
      if (!env.RESEARCH_DB) return failure(toolId, "DATABASE_NOT_CONFIGURED", "专业工具项目存储尚未配置。", id, 503);
      const repository = createResearchStore(env.RESEARCH_DB);
      const payload = await readBody(request);
      const projectId = clean(payload.project_id, 128);
      if (!projectId) return failure(toolId, "INVALID_INPUT", "项目标识不能为空。", id);
      if (!await repository.getProject(userId, projectId)) return failure(toolId, "PROJECT_NOT_FOUND", "项目不存在。", id, 404);
      const input = payload.input && typeof payload.input === "object" ? payload.input : {};
      const executed = executeTool(toolId, input);
      const saved = await repository.createToolResult(userId, projectId, toolId, input, executed.data);
      return json({ success: true, tool: toolId, data: { tool_result: publicResult(saved) }, meta: { deterministic: true, uses_ai: false } }, 201, id);
    }
    return failure(toolId, "NOT_FOUND", "接口不存在。", id, 404);
  } catch (error) {
    const code = clean(error.code || "INTERNAL_ERROR", 64);
    const status = Number(error.status) || (["PROJECT_NOT_FOUND", "TOOL_NOT_FOUND"].includes(code) ? 404 : code === "TOO_LARGE" ? 413 : code === "INTERNAL_ERROR" ? 500 : 400);
    return failure(toolId, code, status === 500 ? "专业工具暂时不可用，请稍后重试。" : error.message || "请求内容无效。", id, status, error.details || null);
  }
}
