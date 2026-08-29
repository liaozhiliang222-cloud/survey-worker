"use strict";

const { randomUUID } = require("node:crypto");
const { collectRequestBody } = require("./request-body");
const { sendJson } = require("./http-response");
const { createHarnessAdapter } = require("./harness");
const { createJsonResearchStore } = require("./research-store");
const { createLocalResearchFileStorage } = require("./research-file-storage");

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ARTIFACT_TYPES = new Set(["research_plan", "questionnaire", "interview_guide", "other"]);
const FILE_CATEGORIES = new Set(["brief", "historical_report", "questionnaire", "interview", "data", "other"]);
const parserModule = import("./project-file-parser.mjs");
const contextModule = import("./project-context.mjs");
const memoryModule = import("./project-memory.mjs");
const diffModule = import("./artifact-diff.mjs");
const ocrModule = import("./project-ocr.mjs");

function publicProject(project) { if (!project) return null; const { user_id, ...safe } = project; return safe; }
function parsedObject(value) { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function publicFile(file, detail = false) { if (!file) return null; const { user_id, storage_path, parsed_text, structured_data, ...safe } = file; return detail ? { ...safe, structured_data: parsedObject(structured_data), preview: String(parsed_text || "").slice(0, 20_000) } : { ...safe, structure_kind: parsedObject(structured_data).kind || null }; }
function requestId(req) { const supplied = String(req.headers["x-request-id"] || "").trim(); return /^[\w.:-]{8,128}$/.test(supplied) ? supplied : randomUUID(); }
function errorPayload(message, type, id, retryable = false) { return { error: { message, type, request_id: id, retryable } }; }
function fullContext(project, artifact, message) {
  const lines = ["你是 SurveyKit 的 AI 调研研究员。请使用中文提供专业、可执行的研究建议。", "", "【项目上下文】", `项目名称：${project.title}`, `客户名称：${project.client_name || "未提供"}`, `项目背景：${project.brief || "未提供"}`, `研究目标：${project.research_goal || "未提供"}`];
  if (artifact) lines.push("", "【正在修改的项目成果】", `标题：${artifact.title}`, `类型：${artifact.type}`, `版本：V${artifact.version}`, artifact.content);
  lines.push("", "【用户当前要求】", message); return lines.join("\n");
}
function sanitizeHarnessError(error, id) {
  if (error?.code === "HARNESS_TIMEOUT") return { status: 504, body: errorPayload("AI 研究员响应超时，请稍后重试。", "harness_timeout", id, true) };
  if (error?.code === "HARNESS_MAX_TOKENS") return { status: 502, body: errorPayload("AI 研究员连续达到输出 token 上限，已保留生成内容，请缩短任务或重试。", "harness_max_tokens", id, true) };
  if (error?.code === "HARNESS_TOOL_BLOCKED") return { status: 502, body: errorPayload("AI 研究员未能按正文模式完成本轮，请重试。", "harness_tool_blocked", id, true) };
  if (error?.code === "HARNESS_NOT_CONFIGURED") return { status: 503, body: errorPayload("AI 研究员尚未完成配置，请联系管理员。", "harness_not_configured", id) };
  if (error?.code === "HARNESS_UPSTREAM" && error?.status === 429) return { status: 429, body: errorPayload("AI 研究员模型额度不足，请充值或稍后重试。", "harness_quota", id, true) };
  if (error?.code === "HARNESS_UPSTREAM" && [401, 403].includes(error?.status)) return { status: 502, body: errorPayload("AI 研究员服务认证失败，请联系管理员。", "harness_auth", id) };
  if (String(error?.code || "").startsWith("HARNESS_")) return { status: 502, body: errorPayload("AI 研究员暂时无法连接，请稍后重试。", "harness_unavailable", id, true) };
  return { status: 500, body: errorPayload("AI 研究员服务暂时不可用，请稍后重试。", "internal_error", id, true) };
}
function readJson(req) {
  return new Promise((resolve, reject) => collectRequestBody(req, MAX_BODY_BYTES, ({ body, error, tooLarge }) => {
    if (error) reject(error); else if (tooLarge) { const e = new Error("TOO_LARGE"); e.code = "TOO_LARGE"; reject(e); }
    else { try { resolve(JSON.parse(body.toString("utf8") || "{}")); } catch { const e = new Error("INVALID_JSON"); e.code = "INVALID_JSON"; reject(e); } }
  }));
}
function readBuffer(req, maximum) {
  return new Promise((resolve, reject) => collectRequestBody(req, maximum, ({ body, error, tooLarge }) => {
    if (error) reject(error); else if (tooLarge) { const issue = new Error("FILE_TOO_LARGE"); issue.code = "FILE_TOO_LARGE"; reject(issue); } else resolve(body);
  }));
}
function integer(value, fallback, minimum, maximum) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback; }
function harnessSendOptions(context, env) {
  const directReplyOnly = Boolean(context?.direct_reply_only);
  return { forbidTools: directReplyOnly, timeoutMs: directReplyOnly ? integer(env.HARNESS_LONG_TASK_TIMEOUT, 180_000, 1, 300_000) : undefined };
}
function decodedHeader(value) { try { return decodeURIComponent(String(value || "")); } catch { return ""; } }

function createResearchHandler({ env = process.env, store = createJsonResearchStore(env), harnessAdapter = createHarnessAdapter({ env }), fileStorage = createLocalResearchFileStorage(env), logger = console } = {}) {
  const inflight = new Map();
  const projectQueues = new Map();
  const usage = new Map();
  const finish = (res, status, payload, id) => sendJson(res, status, payload, {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID, X-Research-File-Name, X-Research-File-Category",
    "X-Research-Request-ID": id,
  });

  function checkUsage(userId) {
    const minuteLimit = integer(env.RESEARCH_AI_REQUESTS_PER_MINUTE, 12, 0, 10_000);
    const dayLimit = integer(env.RESEARCH_AI_REQUESTS_PER_DAY, 500, 0, 1_000_000);
    const timestamp = Date.now(); const minute = Math.floor(timestamp / 60_000); const day = Math.floor(timestamp / 86_400_000);
    const current = usage.get(userId) || { minute, minuteCount: 0, day, dayCount: 0 };
    if (current.minute !== minute) { current.minute = minute; current.minuteCount = 0; }
    if (current.day !== day) { current.day = day; current.dayCount = 0; }
    if ((minuteLimit && current.minuteCount >= minuteLimit) || (dayLimit && current.dayCount >= dayLimit)) { const error = new Error("RATE_LIMIT"); error.code = "RATE_LIMIT"; throw error; }
    current.minuteCount += 1; current.dayCount += 1; usage.set(userId, current);
  }

  function enqueueProjectOperation(projectId, task) {
    const previous = projectQueues.get(projectId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    projectQueues.set(projectId, tail);
    tail.then(() => { if (projectQueues.get(projectId) === tail) projectQueues.delete(projectId); });
    return operation;
  }

  async function parseStoredFile(file, bytes = null) {
    await store.updateFile(file.project_id, file.id, { parse_status: "processing", parse_note: "" });
    try {
      const source = bytes || await fileStorage.get(file.storage_path);
      const { parseProjectFile } = await parserModule;
      const parsed = await parseProjectFile(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), {
        extension: file.file_type,
        fileName: file.file_name,
        maxParsedChars: env.RESEARCH_MAX_PARSED_CHARS,
        summaryChars: env.RESEARCH_FILE_SUMMARY_CHARS,
      });
      await store.updateFile(file.project_id, file.id, { parse_status: parsed.status, parsed_text: parsed.parsedText, summary: parsed.summary, structured_data: JSON.stringify(parsed.structuredData || {}), parse_note: parsed.parseNote, ocr_status: "not_requested", ocr_note: "" });
      const { chunkProjectText } = await memoryModule;
      await store.replaceFileChunks(file.project_id, file.id, parsed.status === "completed" ? chunkProjectText(parsed.parsedText, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }) : []);
    } catch (error) {
      logger.error(JSON.stringify({ event: "research_file_parse_error", file_id: file.id, error_type: error.code || error.message || "parse_failed" }));
      await store.updateFile(file.project_id, file.id, { parse_status: "failed", parsed_text: "", summary: "", parse_note: "文件解析失败，请检查文件是否损坏。" });
      await store.replaceFileChunks(file.project_id, file.id, []);
    }
  }

  async function runFileOcr(file) {
    await store.updateFile(file.project_id, file.id, { ocr_status: "processing", ocr_note: "OCR 处理中。" });
    try {
      const bytes = await fileStorage.get(file.storage_path);
      const { requestProjectOcr } = await ocrModule;
      const result = await requestProjectOcr({ env, file, bytes });
      const text = String(result.text).slice(0, integer(env.RESEARCH_MAX_PARSED_CHARS, 250_000, 2_000, 750_000));
      await store.updateFile(file.project_id, file.id, { parse_status: "completed", parsed_text: text, summary: text.slice(0, integer(env.RESEARCH_FILE_SUMMARY_CHARS, 2_000, 300, 8_000)), parse_note: "文本由外部 OCR 服务提取。", ocr_status: "completed", ocr_note: `已通过 ${result.provider} 完成 OCR。` });
      const { chunkProjectText } = await memoryModule;
      await store.replaceFileChunks(file.project_id, file.id, chunkProjectText(text, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }));
    } catch (error) {
      logger.error(JSON.stringify({ event: "research_file_ocr_error", file_id: file.id, error_type: error.code || error.message || "ocr_failed" }));
      await store.updateFile(file.project_id, file.id, { ocr_status: "failed", ocr_note: "OCR 未完成，请检查外部 OCR 服务配置后重试。" });
    }
  }

  async function projectChunks(projectId, files) {
    const { chunkProjectText } = await memoryModule;
    const existing = await store.listChunks(projectId);
    const indexed = new Set(existing.map((chunk) => String(chunk.file_id)));
    for (const file of files) {
      if (indexed.has(String(file.id)) || file.parse_status !== "completed" || !String(file.parsed_text || "").trim()) continue;
      const saved = await store.replaceFileChunks(projectId, file.id, chunkProjectText(file.parsed_text, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }));
      existing.push(...saved); indexed.add(String(file.id));
    }
    return existing;
  }

  async function sendResearchMessage(userId, project, input, id) {
    const clientRequestId = String(input.client_request_id || "").trim().slice(0, 128) || randomUUID();
    const key = `${project.id}:${clientRequestId}`;
    if (inflight.has(key)) return inflight.get(key);
    const operation = enqueueProjectOperation(project.id, async () => {
      const existing = await store.findRequest(project.id, clientRequestId);
      if (existing?.assistant) return { message: existing.assistant, user_message: existing.user, client_request_id: clientRequestId, idempotent_replay: true };
      const message = String(input.message || "").trim().slice(0, 200_000);
      if (!message) { const e = new Error("MESSAGE_REQUIRED"); e.code = "INVALID"; throw e; }
      let artifact = null;
      if (input.artifact_id) {
        artifact = await store.getArtifact(project.id, String(input.artifact_id));
        if (!artifact) { const e = new Error("ARTIFACT_NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
      }
      const requestedFileIds = Array.isArray(input.selected_file_ids) ? [...new Set(input.selected_file_ids.map((value) => String(value || "").trim()).filter(Boolean))] : [];
      const allFiles = await store.listFiles(project.id);
      const selectedFiles = requestedFileIds.map((fileId) => allFiles.find((file) => file.id === fileId)).filter(Boolean);
      if (selectedFiles.length !== requestedFileIds.length) { const error = new Error("FILE_NOT_FOUND"); error.code = "FILE_NOT_FOUND"; throw error; }
      checkUsage(userId);
      const messages = await store.listMessages(project.id);
      let retrievedChunks = [];
      if (input.auto_retrieve !== false) {
        const { searchProjectChunks } = await memoryModule;
        retrievedChunks = searchProjectChunks(await projectChunks(project.id, allFiles), allFiles, String(input.context_query || message), { excludeFileIds: requestedFileIds, limit: integer(env.RESEARCH_MAX_RETRIEVED_CHUNKS, 5, 1, 12) });
      }
      const { buildProjectContext, contextLimitsFromEnv } = await contextModule;
      const buildPrompt = (includeRecentMessages) => buildProjectContext({ project, files: selectedFiles, retrievedChunks, artifact, recentMessages: messages, userMessage: message, taskType: input.task_type, includeRecentMessages, limits: contextLimitsFromEnv(env) });
      let session = await store.getSession(project.id);
      let recreated = false;
      if (!session) {
        const sessionId = await harnessAdapter.createSession({ title: project.title, requestId: id });
        session = await store.setSession(project.id, sessionId); recreated = true;
      }
      let built = buildPrompt(recreated);
      let reply;
      try {
        reply = await harnessAdapter.sendMessage({ sessionId: session.harness_session_id, prompt: built.prompt, requestId: id, ...harnessSendOptions(built.context, env) });
      } catch (error) {
        if (!recreated && error?.code === "HARNESS_UPSTREAM" && [404, 410].includes(error.status)) {
          const sessionId = await harnessAdapter.createSession({ title: project.title, requestId: id });
          await store.setSession(project.id, sessionId); recreated = true;
          built = buildPrompt(true);
          reply = await harnessAdapter.sendMessage({ sessionId, prompt: built.prompt, requestId: id, ...harnessSendOptions(built.context, env) });
        } else throw error;
      }
      const saved = await store.saveExchange(project.id, clientRequestId, message, reply);
      return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || reply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context };
    });
    inflight.set(key, operation);
    try { return await operation; } finally { inflight.delete(key); }
  }

  return async function handleResearch(req, res) {
    const id = requestId(req); const started = Date.now();
    const log = (status, outcome, extra = {}) => logger.log(JSON.stringify({ event: "research_api", request_id: id, method: req.method, status, outcome, duration_ms: Date.now() - started, ...extra }));
    if (req.method === "OPTIONS") { finish(res, 204, null, id); return; }
    const userId = String(env.RESEARCH_DEV_USER_ID || "").trim();
    if (!userId) { finish(res, 401, errorPayload("请先登录后再使用 AI 研究员。", "unauthorized", id), id); log(401, "error"); return; }
    let requestUrl;
    let segments;
    try {
      requestUrl = new URL(req.url, "http://localhost");
      const pathname = requestUrl.pathname.replace(/^\/api\/research\/?/, "").replace(/\/+$/, "");
      segments = pathname ? pathname.split("/").map((segment) => decodeURIComponent(segment)) : [];
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      finish(res, 400, errorPayload("请求地址无效。", "invalid_request", id), id);
      log(400, "error", { error_type: "malformed_url" });
      return;
    }
    try {
      let body = {};
      const fileUpload = segments.length === 3 && segments[2] === "files" && req.method === "POST";
      if (["POST", "PATCH"].includes(req.method) && !fileUpload) body = await readJson(req);
      if (segments.length === 1 && segments[0] === "health" && req.method === "GET") { finish(res, 200, { ok: true, service: "surveykit-research", harness_configured: harnessAdapter.isConfigured() }, id); log(200, "success"); return; }
      if (segments[0] !== "projects") { finish(res, 404, errorPayload("Not found", "not_found", id), id); log(404, "error"); return; }
      if (segments.length === 1 && req.method === "GET") { finish(res, 200, { projects: (await store.listProjects(userId)).map(publicProject) }, id); log(200, "success"); return; }
      if (segments.length === 1 && req.method === "POST") {
        if (!String(body.title || "").trim()) { finish(res, 400, errorPayload("项目名称不能为空。", "invalid_request", id), id); log(400, "error"); return; }
        const project = await store.createProject(userId, body); finish(res, 201, { project: publicProject(project) }, id); log(201, "success"); return;
      }
      const projectId = segments[1]; const project = await store.getProject(userId, projectId);
      if (!project) { finish(res, 404, errorPayload("项目不存在。", "not_found", id), id); log(404, "error", { project_id: projectId }); return; }
      if (segments.length === 2 && req.method === "GET") { finish(res, 200, { project: publicProject(project) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 2 && req.method === "PATCH") { const updated = await store.updateProject(userId, projectId, body); finish(res, 200, { project: publicProject(updated) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 2 && req.method === "DELETE") { const files = await store.listFiles(projectId); await Promise.all(files.map((file) => fileStorage.delete(file.storage_path))); await store.deleteProject(userId, projectId); res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success", { project_id: projectId }); return; }
      if (segments.length === 3 && segments[2] === "files" && req.method === "GET") { finish(res, 200, { files: (await store.listFiles(projectId)).map((file) => publicFile(file)) }, id); log(200, "success", { project_id: projectId }); return; }
      if (fileUpload) {
        const maximum = integer(env.RESEARCH_MAX_FILE_BYTES, 10 * 1024 * 1024, 1024, 25 * 1024 * 1024);
        const currentFiles = await store.listFiles(projectId); const fileLimit = integer(env.RESEARCH_MAX_FILES_PER_PROJECT, 30, 1, 200);
        if (currentFiles.length >= fileLimit) { finish(res, 409, errorPayload(`每个项目最多上传 ${fileLimit} 个文件。`, "file_limit", id), id); log(409, "error"); return; }
        const bytes = await readBuffer(req, maximum);
        const { validateProjectFile } = await parserModule;
        const validation = validateProjectFile({ fileName: decodedHeader(req.headers["x-research-file-name"]), mimeType: req.headers["content-type"], size: bytes.length, maxBytes: maximum });
        if (!validation.ok) { const status = validation.code === "FILE_TOO_LARGE" ? 413 : 400; finish(res, status, errorPayload(validation.message, validation.code.toLowerCase(), id), id); log(status, "error"); return; }
        const category = FILE_CATEGORIES.has(String(req.headers["x-research-file-category"] || "")) ? String(req.headers["x-research-file-category"]) : "other";
        const fileId = randomUUID(); const storagePath = fileStorage.key(projectId, fileId, validation.extension);
        await fileStorage.put(storagePath, bytes);
        let file;
        try { file = await store.createFile(userId, projectId, { id: fileId, file_name: validation.fileName, file_type: validation.extension, mime_type: validation.mimeType, file_size: bytes.length, category, storage_path: storagePath }); }
        catch (error) { await fileStorage.delete(storagePath); throw error; }
        finish(res, 201, { file: publicFile(file) }, id); log(201, "success", { project_id: projectId, file_id: file.id });
        setImmediate(() => parseStoredFile(file, bytes).catch(() => {})); return;
      }
      if (segments.length === 4 && segments[2] === "files" && req.method === "GET") { const file = await store.getFile(projectId, segments[3]); if (!file) finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); else finish(res, 200, { file: publicFile(file, true) }, id); return; }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "structure" && req.method === "GET") { const file = await store.getFile(projectId, segments[3]); if (!file) finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); else finish(res, 200, { file_id: file.id, file_name: file.file_name, structure: parsedObject(file.structured_data) }, id); return; }
      if (segments.length === 4 && segments[2] === "files" && req.method === "PATCH") { const category = String(body.category || ""); if (!FILE_CATEGORIES.has(category)) { finish(res, 400, errorPayload("文件分类无效。", "invalid_request", id), id); return; } const file = await store.updateFile(projectId, segments[3], { category }); if (!file) finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); else finish(res, 200, { file: publicFile(file) }, id); return; }
      if (segments.length === 4 && segments[2] === "files" && req.method === "DELETE") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } await fileStorage.delete(file.storage_path); await store.deleteFile(projectId, file.id); res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success", { project_id: projectId, file_id: file.id }); return; }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "reparse" && req.method === "POST") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } await store.updateFile(projectId, file.id, { parse_status: "pending", parse_note: "等待重新解析。" }); finish(res, 202, { file: publicFile(await store.getFile(projectId, file.id)) }, id); setImmediate(() => parseStoredFile(file).catch(() => {})); return; }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "ocr" && req.method === "POST") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } const { isOcrConfigured } = await ocrModule; if (!isOcrConfigured(env)) { finish(res, 503, errorPayload("外部 OCR 服务尚未配置。", "ocr_not_configured", id), id); return; } if (file.file_type !== "pdf") { finish(res, 400, errorPayload("当前仅对 PDF 提供按需 OCR。", "ocr_unsupported", id), id); return; } await store.updateFile(projectId, file.id, { ocr_status: "processing", ocr_note: "OCR 已进入处理队列。" }); finish(res, 202, { file: publicFile(await store.getFile(projectId, file.id)) }, id); setImmediate(() => runFileOcr(file).catch(() => {})); return; }
      if (segments.length === 4 && segments[2] === "memory" && segments[3] === "search" && req.method === "GET") { const query = String(requestUrl.searchParams.get("q") || "").trim(); if (!query) { finish(res, 400, errorPayload("请输入检索词。", "invalid_request", id), id); return; } const files = await store.listFiles(projectId); const { searchProjectChunks } = await memoryModule; const matches = searchProjectChunks(await projectChunks(projectId, files), files, query, { limit: integer(requestUrl.searchParams.get("limit"), 8, 1, 12) }).map((item) => ({ ...item, content: String(item.content).slice(0, 1_600) })); finish(res, 200, { query, matches }, id); return; }
      if (segments.length === 3 && segments[2] === "messages" && req.method === "GET") { finish(res, 200, { messages: await store.listMessages(projectId) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 3 && segments[2] === "messages" && req.method === "POST") {
        const result = await sendResearchMessage(userId, project, body, id); finish(res, 200, result, id); log(200, "success", { project_id: projectId, session_recreated: result.session_recreated, idempotent_replay: result.idempotent_replay }); return;
      }
      if (segments.length === 3 && segments[2] === "artifacts" && req.method === "GET") { finish(res, 200, { artifacts: await store.listArtifacts(projectId) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 5 && segments[2] === "artifacts" && segments[4] === "compare" && req.method === "GET") { const target = await store.getArtifact(projectId, segments[3]); if (!target) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); return; } const baseId = String(requestUrl.searchParams.get("with") || target.parent_artifact_id || ""); const base = baseId ? await store.getArtifact(projectId, baseId) : null; if (!base) { finish(res, 409, errorPayload("该成果没有可对比的父版本。", "comparison_unavailable", id), id); return; } const { compareArtifacts } = await diffModule; finish(res, 200, { comparison: compareArtifacts(base, target) }, id); return; }
      if (segments.length === 3 && segments[2] === "artifacts" && req.method === "POST") {
        if (!ARTIFACT_TYPES.has(body.type) || !String(body.title || "").trim() || !String(body.content || "").trim()) { finish(res, 400, errorPayload("成果类型、标题或内容无效。", "invalid_request", id), id); log(400, "error"); return; }
        if (body.parent_artifact_id) { const parent = await store.getArtifact(projectId, String(body.parent_artifact_id)); if (!parent || parent.type !== body.type) { finish(res, 404, errorPayload("父版本成果不存在或类型不一致。", "not_found", id), id); return; } }
        finish(res, 201, { artifact: await store.createArtifact(projectId, body) }, id); log(201, "success", { project_id: projectId }); return;
      }
      if (segments.length === 4 && segments[2] === "artifacts" && req.method === "PATCH") { const artifact = await store.updateArtifact(projectId, segments[3], body); if (!artifact) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); } else { finish(res, 200, { artifact }, id); log(200, "success"); } return; }
      if (segments.length === 4 && segments[2] === "artifacts" && req.method === "DELETE") { const deleted = await store.deleteArtifact(projectId, segments[3]); if (!deleted) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); } else { res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success"); } return; }
      finish(res, 405, errorPayload("Method not allowed", "method_not_allowed", id), id); log(405, "error");
    } catch (error) {
      if (error.code === "INVALID" || error.code === "INVALID_JSON") { finish(res, 400, errorPayload("请求内容无效。", "invalid_request", id), id); log(400, "error"); return; }
      if (error.code === "TOO_LARGE") { finish(res, 413, errorPayload("请求内容过大。", "invalid_request", id), id); log(413, "error"); return; }
      if (error.code === "FILE_TOO_LARGE") { finish(res, 413, errorPayload("文件过大。", "file_too_large", id), id); log(413, "error"); return; }
      if (error.code === "FILE_NOT_FOUND") { finish(res, 404, errorPayload("所选项目文件不存在。", "not_found", id), id); log(404, "error"); return; }
      if (error.code === "RATE_LIMIT") { finish(res, 429, errorPayload("AI 研究员请求过于频繁，请稍后再试。", "rate_limited", id, true), id); log(429, "error"); return; }
      if (error.code === "NOT_FOUND") { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); return; }
      if (error.code === "CONFLICT") { finish(res, 409, errorPayload("项目标识已存在。", "conflict", id), id); log(409, "error"); return; }
      const sanitized = sanitizeHarnessError(error, id); finish(res, sanitized.status, sanitized.body, id); log(sanitized.status, "error", { error_type: sanitized.body.error.type });
    }
  };
}

module.exports = { createResearchHandler, sanitizeHarnessError, fullContext };
