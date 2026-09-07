const readinessModule = import('./research-readiness.mjs');
"use strict";

const { randomUUID } = require("node:crypto");
const { collectRequestBody } = require("./request-body");
const { sendJson } = require("./http-response");
const { createHarnessAdapter } = require("./harness");
const { createJsonResearchStore } = require("./research-store");
const { createLocalResearchFileStorage } = require("./research-file-storage");

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ARTIFACT_TYPES = new Set(["research_plan", "questionnaire", "interview_guide", "qualitative_summary", "qualitative_analysis", "interview_summary", "analysis", "report_outline", "ppt_script", "qualitative_ppt", "other"]);
const FILE_CATEGORIES = new Set(["brief", "historical_report", "questionnaire", "interview", "data", "other"]);
const parserModule = import("./project-file-parser.mjs");
const contextModule = import("./project-context.mjs");
const memoryModule = import("./project-memory.mjs");
const diffModule = import("./artifact-diff.mjs");
const ocrModule = import("./project-ocr.mjs");
const qualitativeExcelModule = import("./qualitative-excel.mjs");
const researchPlanWorkflowModule = import("./research-plan-workflow.mjs");
const dataAnalysisWorkflowModule = import("./data-analysis-workflow.mjs");
const dataJobsModule = import("./data-jobs.mjs");
const dataEngineModule = import("./data-engine.mjs");
const qualitativeAnalysisModule = import("./qualitative-analysis.mjs");
const transcriptCorrectionModule = import("./transcript-correction.mjs");
const reportStorylineModule = import("./report-storyline.mjs");
const pptScriptWorkflowModule = import("./ppt-script-workflow.mjs");
const agentToolAdapterModule = import("./agent-tools/adapter.mjs");

function publicProject(project) { if (!project) return null; const { user_id, ...safe } = project; return { ...safe, constraints: parsedObject(safe.constraints) }; }
function parsedObject(value) { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function parsedJson(value, fallback = null) { if (value && typeof value === "object") return value; try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function publicFile(file, detail = false) { if (!file) return null; const { user_id, storage_path, parsed_text, structured_data, ...safe } = file; return detail ? { ...safe, structured_data: parsedObject(structured_data), preview: String(parsed_text || "").slice(0, 20_000) } : { ...safe, structure_kind: parsedObject(structured_data).kind || null }; }
function publicRecord(item, jsonKeys = []) { if (!item) return null; return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, jsonKeys.includes(key) ? parsedJson(value, Array.isArray(value) ? [] : {}) : value])); }

function publicTranscript(item) { return publicRecord(item, ["respondent_metadata"]); }
function requestId(req) { const supplied = String(req.headers["x-request-id"] || "").trim(); return /^[\w.:-]{8,128}$/.test(supplied) ? supplied : randomUUID(); }
function errorPayload(message, type, id, retryable = false) { return { error: { message, type, request_id: id, retryable } }; }
function fullContext(project, artifact, message) {
  const lines = ["你是 SurveyKit 的 AI 调研研究员。请使用中文提供专业、可执行的研究建议。", "", "【项目上下文】", `项目名称：${project.title}`, `客户名称：${project.client_name || "未提供"}`, `项目背景：${project.brief || "未提供"}`, `研究目标：${project.research_goal || "未提供"}`];
  if (artifact) lines.push("", "【正在修改的项目成果】", `标题：${artifact.title}`, `类型：${artifact.type}`, `版本：V${artifact.version}`, artifact.content);
  lines.push("", "【用户当前要求】", message); return lines.join("\n");
}
function sanitizeHarnessError(error, id) {
  if (error?.code === "QUALITATIVE_EVIDENCE_REQUIRED") return { status: 422, body: errorPayload(error.message, "qualitative_evidence_required", id, true) };
  if (error?.code === "REPORT_EVIDENCE_REQUIRED") return { status: 409, body: errorPayload("当前项目还没有可用于报告大纲的 Research Evidence。请先完成定量或定性分析。", "report_evidence_required", id, false) };
  if (error?.code === "REPORT_STORYLINE_INVALID_JSON") return { status: 502, body: errorPayload("报告大纲结构生成不完整，请重试。", "report_storyline_invalid", id, true) };
  if (error?.code === "PPT_SCRIPT_OUTLINE_REQUIRED") return { status: 409, body: errorPayload("请先选择或生成一份 Report Outline。", "ppt_script_outline_required", id, false) };
  if (error?.code === "PPT_SCRIPT_EVIDENCE_REQUIRED") return { status: 409, body: errorPayload("当前 Report Outline 没有可用于页面脚本的 Evidence。", "ppt_script_evidence_required", id, false) };
  if (error?.code === "PPT_SCRIPT_PAGE_NOT_FOUND") return { status: 404, body: errorPayload("要修改的 PPT Script 页面不存在。", "ppt_script_page_not_found", id, false) };
  if (error?.code === "PPT_SCRIPT_INVALID_JSON") return { status: 502, body: errorPayload("PPT Script 结构生成不完整，请重试。", "ppt_script_invalid", id, true) };
  if (error?.code === "HARNESS_TIMEOUT") return { status: 504, body: errorPayload("AI 研究员响应超时，请稍后重试。", "harness_timeout", id, true) };
  if (error?.code === "HARNESS_MAX_TOKENS") return { status: 502, body: errorPayload("AI 研究员连续达到输出 token 上限，已保留生成内容，请缩短任务或重试。", "harness_max_tokens", id, true) };
  if (error?.code === "HARNESS_TOOL_BLOCKED") return { status: 502, body: errorPayload("AI 研究员未能按正文模式完成本轮，请重试。", "harness_tool_blocked", id, true) };
  if (error?.code === "HARNESS_TOOL_LIMIT") return { status: 502, body: errorPayload("本轮专业工具调用次数超过安全上限，请缩小任务范围后重试。", "harness_tool_limit", id, false) };
  if (error?.code === "HARNESS_NOT_CONFIGURED") return { status: 503, body: errorPayload("AI 研究员尚未完成配置，请联系管理员。", "harness_not_configured", id) };
  if (error?.code === "HARNESS_UPSTREAM" && error?.status === 429) return { status: 429, body: errorPayload("AI 研究员模型额度不足，请充值或稍后重试。", "harness_quota", id, true) };
  if (error?.code === "HARNESS_UPSTREAM" && [401, 403].includes(error?.status)) return { status: 502, body: errorPayload("AI 研究员服务认证失败，请联系管理员。", "harness_auth", id) };
  if (String(error?.code || "").startsWith("HARNESS_")) {
    const code = /^HARNESS_[A-Z_]+$/.test(error.code) ? error.code : "HARNESS_UNKNOWN", status = Number(error.status) || 0;
    const message = code === "HARNESS_BAD_RESPONSE" ? "模型服务返回了空内容或无效响应，请重试。" : status ? `模型服务请求失败（HTTP ${status}），请稍后重试。` : "AI 研究员暂时无法连接，请稍后重试。";
    const body = errorPayload(message, "harness_unavailable", id, true);
    Object.assign(body.error, { cause_code: code, ...(status >= 400 && status <= 599 ? { upstream_status: status } : {}) });
    return { status: 502, body };
  }
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
function harnessSendOptions(context, env, allowedResearchTools) {
  const directReplyOnly = Boolean(context?.direct_reply_only);
  const qualitativeSummary = Boolean(context?.qualitative_summary);
  const noWorkflowTools = Array.isArray(allowedResearchTools) && allowedResearchTools.length === 0;
  const dataAnalysis = context?.workflow_type === "data_analysis";
  return { researchTools: !qualitativeSummary && !noWorkflowTools, forbidTools: qualitativeSummary || noWorkflowTools, allowedResearchTools, maxToolCalls: dataAnalysis ? integer(env.HARNESS_MAX_DATA_TOOL_CALLS, 8, 1, 10) : integer(env.HARNESS_MAX_TOOL_CALLS, 5, 1, 10), timeoutMs: directReplyOnly ? integer(env.HARNESS_LONG_TASK_TIMEOUT, 180_000, 1, 300_000) : undefined };
}

function shouldCreateQuestionnaireVersion(input, artifact, toolCalls) {
  return artifact?.type === "questionnaire" && input?.task_type === "artifact_revision" && /修改|修正|优化|改写|直接改|更新/.test(String(input.message || "")) && toolCalls.some((item) => item.tool_id === "questionnaire_check");
}
function decodedHeader(value) { try { return decodeURIComponent(String(value || "")); } catch { return ""; } }
function inputError(message) { const error = new Error(message); error.code = "QUALITATIVE_EXCEL_INPUT"; return error; }

function qualitativeExcelSelection(files) {
  const templateFile = files.find((file) => parsedObject(file.structured_data).kind === "qualitative_summary_template");
  const interviews = files.filter((file) => file.id !== templateFile?.id && file.parse_status === "completed" && String(file.parsed_text || "").trim());
  if (!templateFile) throw inputError("请选择一份符合格式的访谈小结 Excel 模板。");
  if (!interviews.length) throw inputError("请至少选择一份已完成解析的访谈笔录。");
  return { templateFile, template: parsedObject(templateFile.structured_data), interviews };
}

function transcriptSummaryHarnessEnv(env) {
  return {
    ...env,
    HARNESS_AGENT_PRESET: env.HARNESS_TRANSCRIPT_SUMMARY_AGENT_PRESET || env.HARNESS_AGENT_PRESET,
    HARNESS_MODEL_PROVIDER: env.HARNESS_TRANSCRIPT_SUMMARY_MODEL_PROVIDER || env.HARNESS_MODEL_PROVIDER,
    HARNESS_MODEL: env.HARNESS_TRANSCRIPT_SUMMARY_MODEL || env.HARNESS_MODEL,
    HARNESS_REASONING_EFFORT: env.HARNESS_TRANSCRIPT_SUMMARY_REASONING_EFFORT ?? "",
    HARNESS_TIMEOUT: env.HARNESS_TRANSCRIPT_SUMMARY_TIMEOUT || env.HARNESS_TIMEOUT,
    HARNESS_MAX_CONTINUATIONS: env.HARNESS_TRANSCRIPT_SUMMARY_MAX_CONTINUATIONS || "1",
  };
}

function transcriptCorrectionHarnessEnv(env) {
  return {
    ...env,
    HARNESS_AGENT_PRESET: env.HARNESS_TRANSCRIPT_CORRECTION_AGENT_PRESET || env.HARNESS_AGENT_PRESET,
    HARNESS_MODEL_PROVIDER: env.HARNESS_TRANSCRIPT_CORRECTION_MODEL_PROVIDER || env.HARNESS_MODEL_PROVIDER,
    HARNESS_MODEL: env.HARNESS_TRANSCRIPT_CORRECTION_MODEL || env.HARNESS_MODEL,
    HARNESS_REASONING_EFFORT: env.HARNESS_TRANSCRIPT_CORRECTION_REASONING_EFFORT ?? "",
    HARNESS_TIMEOUT: env.HARNESS_TRANSCRIPT_CORRECTION_TIMEOUT || env.HARNESS_TIMEOUT,
    HARNESS_MAX_CONTINUATIONS: env.HARNESS_TRANSCRIPT_CORRECTION_MAX_CONTINUATIONS || "0",
  };
}

function createResearchHandler({ env = process.env, store = createJsonResearchStore(env), harnessAdapter = null, transcriptSummaryHarnessAdapter = null, transcriptCorrectionHarnessAdapter = null, fileStorage = createLocalResearchFileStorage(env), logger = console } = {}) {
  const createProjectHarnessAdapter = (adapterEnv) => createHarnessAdapter({
    env: adapterEnv,
    logger,
    executeTool: async ({ name, args, sessionId, callId, requestId: toolRequestId }) => {
      const { executeAgentTool } = await agentToolAdapterModule;
      const result = await executeAgentTool({
        agentToolId: name,
        args,
        harnessSessionId: sessionId,
        callId,
        requestId: toolRequestId,
        store,
        fileStorage,
        dataJobRunner: (options) => import("./data-jobs-local.mjs").then(({ runDataToolThread }) => runDataToolThread(options)),
        logger,
      });
      return result.data;
    },
  });
  harnessAdapter ||= createProjectHarnessAdapter(env);
  transcriptSummaryHarnessAdapter ||= createProjectHarnessAdapter(transcriptSummaryHarnessEnv(env));
  transcriptCorrectionHarnessAdapter ||= createProjectHarnessAdapter(transcriptCorrectionHarnessEnv(env));
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
      const datasetFile = file.category === "data" && ["xlsx", "csv", "sav"].includes(file.file_type);
      const datasetStructure = datasetFile && parsed.structuredData?.kind === "xlsx_workbook" ? { ...parsed.structuredData, sheets: (parsed.structuredData.sheets || []).map(({ preview_rows, ...sheet }) => sheet) } : parsed.structuredData;
      const safeDatasetText = datasetFile ? `数据集结构摘要。${(datasetStructure?.sheets || []).map((sheet) => `${sheet.name}: ${sheet.row_count} 行 × ${sheet.column_count} 列；字段：${(sheet.fields || []).join("、")}`).join("\n")}` : parsed.parsedText;
      const updated = await store.updateFile(file.project_id, file.id, { parse_status: parsed.status, parsed_text: safeDatasetText, summary: datasetFile ? safeDatasetText.slice(0, 2_000) : parsed.summary, structured_data: JSON.stringify(datasetStructure || {}), parse_note: datasetFile ? "原始数据行仅保留在 Data Layer，不进入 AI 上下文。" : parsed.parseNote, ocr_status: "not_requested", ocr_note: "" });
      const { chunkProjectText } = await memoryModule;
      await store.replaceFileChunks(file.project_id, file.id, parsed.status === "completed" && !datasetFile ? chunkProjectText(parsed.parsedText, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }) : []);
      if (updated?.category === "interview") { const { syncTranscriptFromFile } = await qualitativeAnalysisModule; await syncTranscriptFromFile({ store, projectId: file.project_id, file: updated }); }
    } catch (error) {
      logger.error(JSON.stringify({ event: "research_file_parse_error", file_id: file.id, error_type: error.code || error.message || "parse_failed" }));
      const failed = await store.updateFile(file.project_id, file.id, { parse_status: "failed", parsed_text: "", summary: "", parse_note: "文件解析失败，请检查文件是否损坏。" });
      await store.replaceFileChunks(file.project_id, file.id, []);
      if (failed?.category === "interview") { const { syncTranscriptFromFile } = await qualitativeAnalysisModule; await syncTranscriptFromFile({ store, projectId: file.project_id, file: failed }); }
    }
  }

  async function runFileOcr(file) {
    await store.updateFile(file.project_id, file.id, { ocr_status: "processing", ocr_note: "OCR 处理中。" });
    try {
      const bytes = await fileStorage.get(file.storage_path);
      const { requestProjectOcr } = await ocrModule;
      const result = await requestProjectOcr({ env, file, bytes });
      const text = String(result.text).slice(0, integer(env.RESEARCH_MAX_PARSED_CHARS, 250_000, 2_000, 750_000));
      const updated = await store.updateFile(file.project_id, file.id, { parse_status: "completed", parsed_text: text, summary: text.slice(0, integer(env.RESEARCH_FILE_SUMMARY_CHARS, 2_000, 300, 8_000)), parse_note: "文本由外部 OCR 服务提取。", ocr_status: "completed", ocr_note: `已通过 ${result.provider} 完成 OCR。` });
      const { chunkProjectText } = await memoryModule;
      await store.replaceFileChunks(file.project_id, file.id, chunkProjectText(text, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }));
      if (updated?.category === "interview") { const { syncTranscriptFromFile } = await qualitativeAnalysisModule; await syncTranscriptFromFile({ store, projectId: file.project_id, file: updated }); }
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
      if (indexed.has(String(file.id)) || file.category === "data" || file.parse_status !== "completed" || !String(file.parsed_text || "").trim()) continue;
      const saved = await store.replaceFileChunks(projectId, file.id, chunkProjectText(file.parsed_text, { targetChars: env.RESEARCH_MEMORY_CHUNK_CHARS, overlapChars: env.RESEARCH_MEMORY_CHUNK_OVERLAP, maxChunks: env.RESEARCH_MAX_CHUNKS_PER_FILE }));
      existing.push(...saved); indexed.add(String(file.id));
    }
    return existing;
  }

  async function saveQualitativeExcelOutput(userId, project, selection, harnessReply) {
    const { alignQualitativeExcelRespondents, fillQualitativeSummaryTemplate, parseQualitativeExcelHarnessReply } = await qualitativeExcelModule;
    const source = await fileStorage.get(selection.templateFile.storage_path);
    const parsed = alignQualitativeExcelRespondents(parseQualitativeExcelHarnessReply(harnessReply), selection.interviews);
    const generated = await fillQualitativeSummaryTemplate(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), parsed);
    const fileId = randomUUID();
    const fileName = `${String(project.title || "项目").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120)}-客户访谈小结.xlsx`;
    const storagePath = fileStorage.key(project.id, fileId, "xlsx");
    await fileStorage.put(storagePath, generated.bytes);
    let file;
    try {
      file = await store.createFile(userId, project.id, { id: fileId, file_name: fileName, file_type: "xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_size: generated.bytes.byteLength, category: "other", storage_path: storagePath });
      file = await store.updateFile(project.id, fileId, {
        parse_status: "completed",
        parsed_text: `已生成 ${generated.respondent_count} 位受访者的逐题 Excel 小结，共 ${generated.sheet_count} 个工作表。`,
        summary: `Harness 已按模板完成 ${generated.respondent_count} 位受访者、${generated.template.question_count} 个问题的小结回填。`,
        structured_data: JSON.stringify({ kind: "qualitative_excel_output", respondent_count: generated.respondent_count, question_count: generated.template.question_count, sheet_count: generated.sheet_count, template_file_id: selection.templateFile.id }),
        parse_note: "由 SurveyKit 根据 Harness 结构化结果回填生成。",
      });
    } catch (error) { await fileStorage.delete(storagePath); throw error; }
    return { file: publicFile(file), respondents: parsed.respondents, generated };
  }

  async function runProjectDataTool(userId, project, agentToolId, args) {
    const { createDataToolExecutor } = await dataEngineModule;
    const executed = await createDataToolExecutor({ store, fileStorage })({ agentToolId, args, scope: { project, user_id: userId } });
    const saved = await store.createToolResult(userId, project.id, executed.gatewayId, executed.input, executed.compact, { source: "user" });
    return { tool_result: { id: saved.id, project_id: saved.project_id, tool_id: saved.tool_id, input: parsedJson(saved.input, {}), result: parsedJson(saved.result, {}), source: saved.source, created_at: saved.created_at }, data: executed.compact };
  }

  let dataSweepRunning = false;
  async function sweepPendingDataJobs() {
    if (dataSweepRunning) return;
    dataSweepRunning = true;
    try { const { sweepLocalDataJobs } = await import("./data-jobs-local.mjs"); await sweepLocalDataJobs({ store, fileStorage, leaseDuration: integer(env.RESEARCH_DATA_JOB_LEASE_MS, 120_000, 1000, 120_000) }); }
    catch (error) { logger.error?.('Data job sweep failed', error.code || error.message); }
    finally { dataSweepRunning = false; }
  }
  // Periodic persisted scan also runs after server restart without any browser.
  const dataJobTimer = setInterval(sweepPendingDataJobs, 1000); dataJobTimer.unref?.();
  sweepPendingDataJobs();
  async function startProjectDataJob(userId, project, agentToolId, args) {
    const { enqueueDataJob } = await dataJobsModule;
    return enqueueDataJob(store,userId,project.id,agentToolId,args,args.idempotency_key);
  }

  async function sendResearchMessage(userId, project, input, id) {
    const clientRequestId = String(input.client_request_id || "").trim().slice(0, 128) || randomUUID();
    const key = `${project.id}:${clientRequestId}`;
    if (inflight.has(key)) return inflight.get(key);
    const operation = enqueueProjectOperation(project.id, async () => {
      let workflow = null; const workflowStarted = Date.now(); const toolCalls = [];
      try {
        const existing = await store.findRequest(project.id, clientRequestId);
        if (existing?.assistant) {
          const replayWorkflow = await store.findWorkflowByRequest(project.id, clientRequestId);
          const { publicWorkflow } = await researchPlanWorkflowModule;
          return { message: existing.assistant, user_message: existing.user, client_request_id: clientRequestId, idempotent_replay: true, ...(replayWorkflow ? { workflow: publicWorkflow(replayWorkflow) } : {}) };
        }
        const message = String(input.message || "").trim().slice(0, 200_000);
        if (!message) { const e = new Error("MESSAGE_REQUIRED"); e.code = "INVALID"; throw e; }
        let artifact = null;
        if (input.artifact_id) {
          artifact = await store.getArtifact(project.id, String(input.artifact_id));
          if (!artifact) { const e = new Error("ARTIFACT_NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
        } else if (input.task_type === "ppt_script") {
          const artifacts = await store.listArtifacts(project.id);
          artifact = (input.page_id || /修改|调整|改为|重写|优化|矩阵|标题|上移|下移|顺序/.test(message) ? artifacts.find((item) => item.type === "ppt_script") : null) || artifacts.find((item) => item.type === "report_outline") || null;
        } else if (["research_plan", "data_analysis", "qualitative_analysis", "interview_summary", "report_storyline"].includes(input.task_type) && /修改|调整|改为|保持不变|重新|继续|提前|对调/.test(message)) {
          const artifactType = input.task_type === "data_analysis" ? "analysis" : input.task_type === "report_storyline" ? "report_outline" : input.task_type;
          artifact = (await store.listArtifacts(project.id)).find((item) => item.type === artifactType) || null;
        }
        const workflowTools = await researchPlanWorkflowModule;
        const dataWorkflowTools = await dataAnalysisWorkflowModule;
        const qualitativeTools = await qualitativeAnalysisModule;
        const reportTools = await reportStorylineModule;
        const scriptTools = await pptScriptWorkflowModule;
        const formalPlan = workflowTools.isResearchPlanWorkflow(input.task_type, artifact);
        const formalData = dataWorkflowTools.isDataAnalysisWorkflow(input.task_type, artifact);
        const formalQualitative = qualitativeTools.isQualitativeAnalysisWorkflow(input.task_type, artifact);
        const formalReport = reportTools.isReportStorylineWorkflow(input.task_type, artifact);
        const formalScript = scriptTools.isPptScriptWorkflow(input.task_type, artifact);
        const findQuotes = input.task_type === "find_quotes";
        const interviewSummary = input.task_type === "interview_summary" || (input.task_type === "artifact_revision" && artifact?.type === "interview_summary");
        const formalWorkflow = formalPlan || formalData || formalQualitative || formalReport || formalScript;
        const requestedFileIds = formalReport || formalScript ? [] : Array.isArray(input.selected_file_ids) ? [...new Set(input.selected_file_ids.map((value) => String(value || "").trim()).filter(Boolean))] : [];
        const allFiles = await store.listFiles(project.id);
        const selectedFiles = requestedFileIds.map((fileId) => allFiles.find((file) => file.id === fileId)).filter(Boolean);
        if (selectedFiles.length !== requestedFileIds.length) { const error = new Error("FILE_NOT_FOUND"); error.code = "FILE_NOT_FOUND"; throw error; }
        if (selectedFiles.some((file) => file.category === "data")) { const error = new Error("DATASET_CONTEXT_FORBIDDEN"); error.code = "DATASET_CONTEXT_FORBIDDEN"; throw error; }
        if (formalQualitative || findQuotes || interviewSummary) {
          for (const file of allFiles.filter((item) => item.category === "interview")) await qualitativeTools.syncTranscriptFromFile({ store, projectId: project.id, file });
        }
        const transcriptScopeFileIds = new Set((requestedFileIds.length ? selectedFiles : allFiles.filter((file) => file.category === "interview")).map((file) => file.id));
        const selectedTranscripts = (formalQualitative || findQuotes || interviewSummary) ? (await store.listTranscripts(project.id)).filter((item) => item.status === "ready" && transcriptScopeFileIds.has(item.file_id)) : [];
        const failedInterviewFiles = (formalQualitative || findQuotes || interviewSummary) ? allFiles.filter((file) => transcriptScopeFileIds.has(file.id) && file.category === "interview" && file.parse_status === "failed") : [];
        if ((formalQualitative || findQuotes || interviewSummary) && !selectedTranscripts.length) { const error = new Error("TRANSCRIPTS_REQUIRED"); error.code = "TRANSCRIPTS_REQUIRED"; throw error; }
        if (interviewSummary && selectedTranscripts.length !== 1) { const error = new Error("INTERVIEW_SUMMARY_SCOPE"); error.code = "INTERVIEW_SUMMARY_SCOPE"; throw error; }
        let activeDataset = null;
        if (formalData) {
          const datasets = await store.listDatasets(project.id); activeDataset = input.dataset_id ? await store.getDataset(project.id, String(input.dataset_id)) : datasets.find((item) => item.status === "ready") || null;
          if (!activeDataset) { const error = new Error("DATASET_REQUIRED"); error.code = "DATASET_REQUIRED"; throw error; }
        }
        const currentScriptArtifact = formalScript && artifact?.type === "ppt_script" ? artifact : null;
        const scriptContent = currentScriptArtifact ? parsedObject(currentScriptArtifact.content) : null;
        const outlineArtifact = formalScript ? (artifact?.type === "report_outline" ? artifact : scriptContent?.source_report_outline_id ? await store.getArtifact(project.id, scriptContent.source_report_outline_id) : null) : null;
        if (formalScript && (!outlineArtifact || outlineArtifact.type !== "report_outline")) { const error = new Error("PPT_SCRIPT_OUTLINE_REQUIRED"); error.code = "PPT_SCRIPT_OUTLINE_REQUIRED"; throw error; }
        if (formalScript && input.page_id && !currentScriptArtifact) { const error = new Error("PPT_SCRIPT_PAGE_NOT_FOUND"); error.code = "PPT_SCRIPT_PAGE_NOT_FOUND"; throw error; }
        if (formalWorkflow) {
          const workflowType = formalData ? "data_analysis" : formalQualitative ? "qualitative_analysis" : formalReport ? "report_storyline" : formalScript ? "ppt_script" : "research_plan";
          const workflowConstraints = formalData ? { dataset_id: activeDataset.id } : formalQualitative ? { transcript_ids: selectedTranscripts.map((item) => item.id), failed_file_ids: failedInterviewFiles.map((item) => item.id), research_question: message } : formalReport ? { report_constraints: { ...(parsedObject(project.constraints).report_constraints || {}), ...(input.report_constraints || {}) }, structure_only: artifact?.type === "report_outline" } : formalScript ? { source_report_outline_id: outlineArtifact.id, current_script_id: currentScriptArtifact?.id || "", target_page_id: String(input.page_id || "") } : parsedObject(project.constraints);
          const selectedWorkflow = input.workflow_id ? await store.getWorkflow(project.id, String(input.workflow_id)) : await store.createWorkflow(project.id, { client_request_id: clientRequestId, task_type: workflowType, parent_artifact_id: artifact?.id, constraints: workflowConstraints });
          if (!selectedWorkflow || (input.workflow_id && selectedWorkflow.status !== "waiting_input")) { const error = new Error("WORKFLOW_NOT_RESUMABLE"); error.code = "INVALID"; throw error; }
          workflow = selectedWorkflow;
          const stages = formalData ? dataWorkflowTools.dataAnalysisWorkflowStages : formalQualitative ? qualitativeTools.qualitativeAnalysisWorkflowStages : formalReport ? reportTools.reportStorylineWorkflowStages : formalScript ? scriptTools.pptScriptWorkflowStages : workflowTools.researchPlanWorkflowStages;
          await store.updateWorkflow(project.id, workflow.id, { status: "running", started_at: new Date().toISOString(), stages: stages.map((stage, index) => ({ ...stage, status: index === 0 ? "running" : "pending" })) });
        }
        const qualitativeExcel = input.task_type === "qualitative_excel_summary";
        checkUsage(userId);
        const messages = await store.listMessages(project.id);
        const beforeToolResults = await store.listToolResults(project.id);
        const beforeToolIds = new Set(beforeToolResults.map((item) => item.id));
        const reportEvidence = formalReport ? await store.listEvidence(project.id, { limit: integer(env.RESEARCH_REPORT_MAX_EVIDENCE, 160, 20, 200) }) : [];
        const reportInsights = formalReport ? await store.listResearchInsights(project.id) : [];
        const reportArtifacts = formalReport ? await store.listArtifacts(project.id) : [];
        const evidenceIndex = formalReport ? reportTools.buildEvidenceIndex({ evidence: reportEvidence, insights: reportInsights, artifacts: reportArtifacts, maxEvidence: integer(env.RESEARCH_REPORT_MAX_EVIDENCE, 160, 20, 200), maxChars: integer(env.RESEARCH_REPORT_EVIDENCE_CONTEXT_CHARS, 48_000, 8_000, 80_000) }) : null;
        if (formalReport && !evidenceIndex.counts.total) { const error = new Error("REPORT_EVIDENCE_REQUIRED"); error.code = "REPORT_EVIDENCE_REQUIRED"; throw error; }
        const scriptEvidence = formalScript ? await store.listEvidence(project.id, { limit: integer(env.RESEARCH_PPT_SCRIPT_MAX_EVIDENCE, 200, 20, 200) }) : [];
        const scriptInsights = formalScript ? await store.listResearchInsights(project.id) : [];
        const scriptEvidenceContext = formalScript ? scriptTools.buildPptScriptEvidenceContext({ outlineArtifact, scriptArtifact: currentScriptArtifact, targetPageId: String(input.page_id || ""), evidence: scriptEvidence, insights: scriptInsights, maxChars: integer(env.RESEARCH_PPT_SCRIPT_EVIDENCE_CONTEXT_CHARS, 48_000, 8_000, 80_000) }) : null;
        const toolPolicy = formalPlan ? workflowTools.classifyResearchPlanToolPolicy({ message, project, artifact, toolResults: beforeToolResults }) : formalData ? dataWorkflowTools.dataAnalysisToolPolicy(activeDataset, beforeToolResults) : (formalQualitative || findQuotes || interviewSummary) ? { allowed_tools: ["transcript_search", "transcript_read"], reusable_results: [] } : (formalReport || formalScript) ? { allowed_tools: [], reusable_results: [] } : null;
        let retrievedChunks = [];
        if (!qualitativeExcel && !formalQualitative && !findQuotes && !interviewSummary && !formalReport && !formalScript && input.auto_retrieve !== false) {
          const { searchProjectChunks } = await memoryModule;
          retrievedChunks = searchProjectChunks(await projectChunks(project.id, allFiles), allFiles, String(input.context_query || message), { excludeFileIds: requestedFileIds, limit: integer(env.RESEARCH_MAX_RETRIEVED_CHUNKS, 5, 1, 12) });
        }
        const { buildProjectContext, contextLimitsFromEnv, normalizeInterviewGuideFormatting } = await contextModule;
        const excelSelection = qualitativeExcel ? qualitativeExcelSelection(selectedFiles) : null;
        const { buildQualitativeExcelPrompt } = qualitativeExcel ? await qualitativeExcelModule : {};
        const contextTaskType = input.task_type === "artifact_revision" && artifact?.type === "qualitative_summary" ? "qualitative_summary" : input.task_type;
        const buildPrompt = (includeRecentMessages) => {
          const base = formalScript ? scriptTools.buildPptScriptPrompt({ project, message, outlineArtifact, scriptArtifact: currentScriptArtifact, evidenceContext: scriptEvidenceContext, targetPageId: String(input.page_id || ""), maxChars: integer(env.RESEARCH_PPT_SCRIPT_MAX_CONTEXT_CHARS, 70_000, 12_000, 100_000) }) : formalReport ? reportTools.buildReportStorylinePrompt({ project, message, evidenceIndex, currentOutline: artifact, reportConstraints: { ...(parsedObject(project.constraints).report_constraints || {}), ...(input.report_constraints || {}) }, maxChars: integer(env.RESEARCH_REPORT_MAX_CONTEXT_CHARS, 60_000, 12_000, 100_000) }) : qualitativeExcel ? {
            prompt: buildQualitativeExcelPrompt({ project, template: excelSelection.template, interviews: excelSelection.interviews, userMessage: message, maxTranscriptChars: integer(env.RESEARCH_QUALITATIVE_EXCEL_MAX_TRANSCRIPT_CHARS, 90_000, 20_000, 180_000) }),
            context: { task_type: "qualitative_excel_summary", qualitative_summary: true, qualitative_excel_summary: true, direct_reply_only: true, selected_files: selectedFiles.map((file) => ({ id: file.id, name: file.file_name, status: file.parse_status, complete: true })), retrieved_chunks: [], artifact: null, recent_message_count: 0 },
          } : buildProjectContext({ project, files: formalQualitative || findQuotes || interviewSummary ? [] : selectedFiles, retrievedChunks: formalQualitative || findQuotes || interviewSummary ? [] : retrievedChunks, artifact, recentMessages: messages, userMessage: message, taskType: input.task_type, includeRecentMessages, limits: contextLimitsFromEnv(env, contextTaskType) });
          if (formalPlan) {
            base.prompt = workflowTools.enhanceResearchPlanPrompt({ basePrompt: base.prompt, project, artifact, message, toolPolicy, toolResults: beforeToolResults, maxChars: base.context.max_chars });
            base.context = { ...base.context, workflow_id: workflow.id, workflow_type: "research_plan", reused_tool_result_ids: toolPolicy.reusable_results.map((item) => item.id), allowed_tools: toolPolicy.allowed_tools };
          } else if (formalData) {
            base.prompt = dataWorkflowTools.enhanceDataAnalysisPrompt({ basePrompt: base.prompt, dataset: activeDataset, message, toolResults: toolPolicy.reusable_results, maxChars: base.context.max_chars });
            base.context = { ...base.context, workflow_id: workflow.id, workflow_type: "data_analysis", dataset_id: activeDataset.id, dataset: { id: activeDataset.id, name: activeDataset.name, type: activeDataset.type, row_count: activeDataset.row_count, column_count: activeDataset.column_count }, reused_tool_result_ids: toolPolicy.reusable_results.map((item) => item.id), allowed_tools: toolPolicy.allowed_tools, raw_rows_included: false };
          } else if (formalQualitative || findQuotes || interviewSummary) {
            base.prompt = qualitativeTools.enhanceQualitativeAnalysisPrompt({ basePrompt: base.prompt, message, transcripts: selectedTranscripts, failedFiles: failedInterviewFiles, maxChars: base.context.max_chars, findQuotesOnly: findQuotes, interviewSummaryOnly: interviewSummary });
            const readySummaryCount = selectedTranscripts.filter((item) => item.summary_status === "ready" && item.deep_summary && item.summary_source_fingerprint === item.source_fingerprint).length;
            base.context = { ...base.context, ...(formalQualitative ? { workflow_id: workflow.id, workflow_type: "qualitative_analysis" } : { workflow_type: findQuotes ? "find_quotes" : "interview_summary" }), transcript_count: selectedTranscripts.length, transcript_ids: selectedTranscripts.map((item) => item.id), transcript_deep_summary_ready_count: readySummaryCount, transcript_deep_summary_fallback_count: selectedTranscripts.length - readySummaryCount, failed_file_count: failedInterviewFiles.length, allowed_tools: toolPolicy.allowed_tools, raw_transcript_chars_in_prompt: 0 };
          }
          return base;
        };
        let session = await store.getSession(project.id);
        let recreated = false;
        if (!session) { const sessionId = await harnessAdapter.createSession({ title: project.title, requestId: id }); session = await store.setSession(project.id, sessionId); recreated = true; }
        let built = buildPrompt(recreated); let reply;
        const onToolStatus = (status) => { const index = toolCalls.findIndex((item) => item.tool_id === status.tool_id); if (index >= 0) toolCalls[index] = status; else toolCalls.push(status); };
        const sendOptions = () => ({ ...harnessSendOptions(built.context, env, formalWorkflow || findQuotes || interviewSummary ? toolPolicy.allowed_tools : undefined), ...(formalQualitative || findQuotes || interviewSummary ? { maxToolCalls: Math.min(8, integer(env.HARNESS_MAX_QUALITATIVE_TOOL_CALLS, 8, 2, 10)), toolBudgets: { transcript_search: findQuotes || interviewSummary ? 2 : 3, transcript_read: findQuotes ? 5 : interviewSummary ? 4 : 5 } } : {}), onToolStatus });
        try { reply = await harnessAdapter.sendMessage({ sessionId: session.harness_session_id, prompt: built.prompt, requestId: id, ...sendOptions() }); }
        catch (error) {
          if (!recreated && error?.code === "HARNESS_UPSTREAM" && [404, 410].includes(error.status)) {
            const sessionId = await harnessAdapter.createSession({ title: project.title, requestId: id }); await store.setSession(project.id, sessionId); recreated = true; built = buildPrompt(true);
            reply = await harnessAdapter.sendMessage({ sessionId, prompt: built.prompt, requestId: id, ...sendOptions() });
          } else throw error;
        }
        const isInterviewGuide = input.task_type === "interview_guide" || (input.task_type === "artifact_revision" && artifact?.type === "interview_guide");
        if (isInterviewGuide) reply = normalizeInterviewGuideFormatting(reply);
        let generatedFile = null; let artifactCreated = null; let quality = null;
        if (qualitativeExcel) {
          const output = await saveQualitativeExcelOutput(userId, project, excelSelection, reply); generatedFile = output.file;
          reply = `已按 Excel 模板完成 ${output.generated.respondent_count} 位受访者、${output.generated.template.question_count} 个问题的逐题小结，并生成 ${output.generated.sheet_count} 个工作表。未涉及的问题已标记为“本次访谈未涉及”。可在项目文件中下载：${generatedFile.file_name}`;
        }
        if (formalScript) {
          const finalized = await scriptTools.finalizePptScript({ store, projectId: project.id, projectTitle: project.title, reply, outlineArtifact, evidence: scriptEvidence.filter((item) => scriptEvidenceContext.included_evidence_ids.includes(item.id)), currentScriptArtifact, targetPageId: String(input.page_id || "") });
          artifactCreated = finalized.artifact; quality = finalized.quality;
          const assistantReply = scriptTools.summarizePptScriptResult({ artifact: artifactCreated, quality });
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          workflow = await store.updateWorkflow(project.id, workflow.id, { status: "completed", artifact_id: artifactCreated.id, parent_artifact_id: artifact?.id || "", tool_calls: [], tool_result_ids: [], stages: scriptTools.pptScriptWorkflowStages.map((stage) => ({ ...stage, status: "completed" })), quality, constraints: { source_report_outline_id: outlineArtifact.id, current_script_id: currentScriptArtifact?.id || "", target_page_id: String(input.page_id || ""), evidence_snapshot_ids: scriptEvidenceContext.included_evidence_ids, raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0 }, error: "", completed_at: new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.log(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: "ppt_script", status: "completed", page_count: quality.page_count, artifact_id: artifactCreated.id, duration_ms: Date.now() - workflowStarted }));
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: [], workflow: workflowTools.publicWorkflow(workflow), artifact_created: artifactCreated, ppt_script: finalized.script, quality };
        }
        if (formalReport) {
          const finalized = await reportTools.finalizeReportStoryline({ store, projectId: project.id, projectTitle: project.title, reply, evidence: reportEvidence, existingInsights: reportInsights, parentArtifactId: artifact?.id, existingOutline: artifact?.type === "report_outline" ? parsedObject(artifact.content) : null });
          artifactCreated = finalized.artifact; quality = finalized.quality;
          const assistantReply = reportTools.summarizeReportStorylineResult({ artifact: artifactCreated, quality });
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          workflow = await store.updateWorkflow(project.id, workflow.id, { status: "completed", artifact_id: artifactCreated.id, parent_artifact_id: artifact?.id || "", tool_calls: [], tool_result_ids: [], stages: reportTools.reportStorylineWorkflowStages.map((stage) => ({ ...stage, status: "completed" })), quality, constraints: { report_constraints: { ...(parsedObject(project.constraints).report_constraints || {}), ...(input.report_constraints || {}) }, structure_only: artifact?.type === "report_outline", evidence_snapshot_ids: evidenceIndex.included_evidence_ids, raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0 }, error: "", completed_at: new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.log(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: "report_storyline", status: "completed", evidence_count: reportEvidence.length, insight_count: quality.core_insight_count, artifact_id: artifactCreated.id, duration_ms: Date.now() - workflowStarted }));
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: [], workflow: workflowTools.publicWorkflow(workflow), artifact_created: artifactCreated, outline: finalized.outline, quality };
        }
        if (formalPlan) {
          const outcome = workflowTools.parseResearchPlanOutcome(reply); reply = outcome.content;
          const afterToolResults = await store.listToolResults(project.id);
          const usedToolResults = afterToolResults.filter((item) => !beforeToolIds.has(item.id) || toolPolicy.reusable_results.some((reused) => reused.id === item.id));
          quality = workflowTools.evaluateResearchPlanQuality({ content: reply, project, toolResults: usedToolResults, toolCalls });
          const waiting = outcome.status === "waiting_input" || workflowTools.researchPlanToolFailure({ content: reply, toolCalls });
          const stageState = workflowTools.researchPlanWorkflowStages.map((stage) => ({ ...stage, status: waiting && stage.id === "tool_work" ? "waiting_input" : waiting && ["quality_gate", "artifact"].includes(stage.id) ? "pending" : "completed" }));
          if (!waiting) artifactCreated = await store.createArtifact(project.id, { type: "research_plan", title: `${project.title}——调研方案`, content: reply, parent_artifact_id: artifact?.id });
          const assistantReply = waiting ? reply : workflowTools.summarizeResearchPlanResult({ artifact: artifactCreated, quality, toolCalls });
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          workflow = await store.updateWorkflow(project.id, workflow.id, { status: waiting ? "waiting_input" : "completed", artifact_id: artifactCreated?.id || "", parent_artifact_id: artifact?.id || "", tool_calls: toolCalls, tool_result_ids: usedToolResults.map((item) => item.id), stages: stageState, quality, error: waiting ? "关键输入或确定性工具结果尚未就绪。" : "", completed_at: waiting ? null : new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.log(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: "research_plan", status: workflow.status, tool_calls: toolCalls.map((item) => item.tool_id), artifact_id: artifactCreated?.id || null, duration_ms: Date.now() - workflowStarted }));
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, workflow: workflowTools.publicWorkflow(workflow), ...(artifactCreated ? { artifact_created: artifactCreated } : {}) };
        }
        if (formalData) {
          const afterToolResults = await store.listToolResults(project.id); const usedToolResults = afterToolResults.filter((item) => !beforeToolIds.has(item.id) || toolPolicy.reusable_results.some((reused) => reused.id === item.id));
          const waitingStage = dataWorkflowTools.dataMutationAwaitingConfirmation(usedToolResults); const waiting = Boolean(waitingStage);
          quality = dataWorkflowTools.evaluateDataAnalysisQuality({ content: reply, toolResults: usedToolResults });
          const stageState = dataWorkflowTools.dataAnalysisWorkflowStages.map((stage) => ({ ...stage, status: waiting && stage.id === waitingStage ? "waiting_input" : waiting && ["analysis_plan", "crosstab", "interpretation", "artifact"].includes(stage.id) ? "pending" : "completed" }));
          if (!waiting) artifactCreated = await store.createArtifact(project.id, { type: "analysis", title: `${project.title}——核心差异分析`, content: reply, parent_artifact_id: artifact?.id });
          const assistantReply = waiting ? reply : dataWorkflowTools.summarizeDataAnalysisResult({ artifact: artifactCreated, quality, toolCalls });
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          workflow = await store.updateWorkflow(project.id, workflow.id, { status: waiting ? "waiting_input" : "completed", artifact_id: artifactCreated?.id || "", parent_artifact_id: artifact?.id || "", tool_calls: toolCalls, tool_result_ids: usedToolResults.map((item) => item.id), stages: stageState, quality, constraints: { dataset_id: activeDataset.id }, error: waiting ? (waitingStage === "weighting" ? "加权方案需要用户明确确认。" : "清洗计划需要用户明确确认。") : "", completed_at: waiting ? null : new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.log(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: "data_analysis", status: workflow.status, dataset_id: activeDataset.id, tool_calls: toolCalls.map((item) => item.tool_id), artifact_id: artifactCreated?.id || null, duration_ms: Date.now() - workflowStarted }));
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, workflow: workflowTools.publicWorkflow(workflow), ...(artifactCreated ? { artifact_created: artifactCreated } : {}) };
        }
        if (formalQualitative) {
          const afterToolResults = await store.listToolResults(project.id);
          const usedToolResults = afterToolResults.filter((item) => !beforeToolIds.has(item.id) && ["transcript-search", "transcript-read"].includes(item.tool_id));
          const finalized = await qualitativeTools.finalizeQualitativeAnalysis({ store, projectId: project.id, projectTitle: project.title, reply, parentArtifactId: artifact?.id, transcripts: selectedTranscripts, failedFiles: failedInterviewFiles });
          artifactCreated = finalized.artifact; quality = finalized.quality;
          const assistantReply = qualitativeTools.summarizeQualitativeAnalysisResult({ artifact: artifactCreated, quality });
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          workflow = await store.updateWorkflow(project.id, workflow.id, { status: "completed", artifact_id: artifactCreated.id, parent_artifact_id: artifact?.id || "", tool_calls: toolCalls, tool_result_ids: usedToolResults.map((item) => item.id), stages: qualitativeTools.qualitativeAnalysisWorkflowStages.map((stage) => ({ ...stage, status: "completed" })), quality, constraints: { transcript_ids: selectedTranscripts.map((item) => item.id), failed_file_ids: failedInterviewFiles.map((item) => item.id), research_question: message, raw_transcript_chars_in_prompt: 0 }, error: "", completed_at: new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.log(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: "qualitative_analysis", status: workflow.status, transcript_count: selectedTranscripts.length, verified_quote_count: quality.verified_quote_count, artifact_id: artifactCreated.id, duration_ms: Date.now() - workflowStarted }));
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, workflow: workflowTools.publicWorkflow(workflow), artifact_created: artifactCreated, evidence: finalized.evidence.map((item) => publicRecord(item, ["value"])), quality };
        }
        if (findQuotes) {
          const finalized = await qualitativeTools.finalizeQuoteSearch({ store, projectId: project.id, reply, transcripts: selectedTranscripts });
          const saved = await store.saveExchange(project.id, clientRequestId, message, finalized.content);
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || finalized.content, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, evidence: finalized.evidence.map((item) => publicRecord(item, ["value"])), quality: finalized.quality };
        }
        if (interviewSummary) {
          const finalized = await qualitativeTools.finalizeInterviewSummary({ store, projectId: project.id, projectTitle: project.title, reply, parentArtifactId: artifact?.id, transcript: selectedTranscripts[0] }); artifactCreated = finalized.artifact;
          const assistantReply = `单篇访谈小结已完成并保存为《${artifactCreated.title}》V${artifactCreated.version}，逐字校验 ${finalized.quality.verified_quote_count} 条原声。`;
          const saved = await store.saveExchange(project.id, clientRequestId, message, assistantReply);
          return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || assistantReply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, artifact_created: artifactCreated, evidence: finalized.evidence.map((item) => publicRecord(item, ["value"])), quality: finalized.quality };
        }
        const saved = await store.saveExchange(project.id, clientRequestId, message, reply);
        if (!saved.duplicate && shouldCreateQuestionnaireVersion(input, artifact, toolCalls)) artifactCreated = await store.createArtifact(project.id, { type: "questionnaire", title: artifact.title, content: reply, parent_artifact_id: artifact.id });
        else if (!saved.duplicate && ["qualitative_summary", "qualitative_excel_summary"].includes(input.task_type)) artifactCreated = await store.createArtifact(project.id, { type: "qualitative_summary", title: input.task_type === "qualitative_excel_summary" ? `${project.title} 客户访谈 Excel 小结` : `${project.title} 定性小结`, content: reply });
        return { message: saved.assistant, user_message: saved.user, reply: saved.assistant?.content || reply, client_request_id: clientRequestId, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, tool_calls: toolCalls, ...(artifactCreated ? { artifact_created: artifactCreated } : {}), ...(generatedFile ? { generated_file: generatedFile } : {}) };
      } catch (error) {
        if (workflow?.id) {
          const safeError = sanitizeHarnessError(error, id).body.error;
          await store.updateWorkflow(project.id, workflow.id, { status: "failed", tool_calls: toolCalls, error: safeError.message, completed_at: new Date().toISOString(), duration_ms: Date.now() - workflowStarted });
          logger.error(JSON.stringify({ event: "research_workflow", workflow_id: workflow.id, project_id: project.id, task_type: workflow.task_type || "research_plan", status: "failed", error_type: safeError.type, duration_ms: Date.now() - workflowStarted }));
        }
        throw error;
      }
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
      if (segments.length === 3 && segments[2] === "readiness" && req.method === "GET") { const { readProjectReadiness } = await readinessModule; finish(res, 200, { readiness: await readProjectReadiness(store, projectId) }, id); return; }
      if (segments.length === 2 && req.method === "GET") { finish(res, 200, { project: publicProject(project) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 2 && req.method === "PATCH") { const updated = await store.updateProject(userId, projectId, body); finish(res, 200, { project: publicProject(updated) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 2 && req.method === "DELETE") {
        const files = await store.listFiles(projectId); const datasets = await store.listDatasets(projectId);
        const keys = [...new Set([...files, ...datasets].map((item) => item.storage_key || item.storage_path).filter(Boolean))];
        const deletions = await Promise.allSettled(keys.map((key) => fileStorage.delete(key)));
        const failed = deletions.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        await store.deleteProject(userId, projectId);
        res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success", { project_id: projectId }); return;
      }
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
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "download" && req.method === "GET") {
        const file = await store.getFile(projectId, segments[3]);
        if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; }
        const bytes = await fileStorage.get(file.storage_path);
        res.writeHead(200, { "Content-Type": file.mime_type || "application/octet-stream", "Content-Length": bytes.length, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`, "Cache-Control": "private, no-store", "X-Research-Request-ID": id });
        res.end(bytes); return;
      }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "structure" && req.method === "GET") { const file = await store.getFile(projectId, segments[3]); if (!file) finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); else finish(res, 200, { file_id: file.id, file_name: file.file_name, structure: parsedObject(file.structured_data) }, id); return; }
      if (segments.length === 4 && segments[2] === "files" && req.method === "PATCH") { const category = String(body.category || ""); if (!FILE_CATEGORIES.has(category)) { finish(res, 400, errorPayload("文件分类无效。", "invalid_request", id), id); return; } const datasets = await store.listDatasets(projectId); if (category !== "data" && datasets.some((dataset) => dataset.source_file_id === segments[3])) { finish(res, 409, errorPayload("原始数据集的源文件必须保持为数据文件分类。", "dataset_source_immutable", id), id); return; } const file = await store.updateFile(projectId, segments[3], { category }); if (!file) finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); else { if (file.category === "interview") { const { syncTranscriptFromFile } = await qualitativeAnalysisModule; await syncTranscriptFromFile({ store, projectId, file }); } finish(res, 200, { file: publicFile(file) }, id); } return; }
      if (segments.length === 4 && segments[2] === "files" && req.method === "DELETE") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } const datasets = await store.listDatasets(projectId); if (datasets.some((dataset) => dataset.source_file_id === file.id)) { finish(res, 409, errorPayload("该文件是原始数据集的不可变源文件；请删除整个项目或保留该文件。", "dataset_source_immutable", id), id); return; } await store.deleteFile(projectId, file.id); await fileStorage.delete(file.storage_path); res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success", { project_id: projectId, file_id: file.id }); return; }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "reparse" && req.method === "POST") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } await store.updateFile(projectId, file.id, { parse_status: "pending", parse_note: "等待重新解析。" }); finish(res, 202, { file: publicFile(await store.getFile(projectId, file.id)) }, id); setImmediate(() => parseStoredFile(file).catch(() => {})); return; }
      if (segments.length === 5 && segments[2] === "files" && segments[4] === "ocr" && req.method === "POST") { const file = await store.getFile(projectId, segments[3]); if (!file) { finish(res, 404, errorPayload("文件不存在。", "not_found", id), id); return; } const { isOcrConfigured } = await ocrModule; if (!isOcrConfigured(env)) { finish(res, 503, errorPayload("外部 OCR 服务尚未配置。", "ocr_not_configured", id), id); return; } if (file.file_type !== "pdf") { finish(res, 400, errorPayload("当前仅对 PDF 提供按需 OCR。", "ocr_unsupported", id), id); return; } await store.updateFile(projectId, file.id, { ocr_status: "processing", ocr_note: "OCR 已进入处理队列。" }); finish(res, 202, { file: publicFile(await store.getFile(projectId, file.id)) }, id); setImmediate(() => runFileOcr(file).catch(() => {})); return; }
      if (segments.length === 3 && segments[2] === "datasets" && req.method === "GET") { const { publicDataset } = await dataEngineModule; finish(res, 200, { datasets: (await store.listDatasets(projectId)).map(publicDataset) }, id); return; }
      if (segments.length === 3 && segments[2] === "datasets" && req.method === "POST") { const file = await store.getFile(projectId, String(body.file_id || "")); if (!file) { finish(res, 404, errorPayload("数据文件不存在。", "not_found", id), id); return; } const { registerRawDataset, publicDataset } = await dataEngineModule; const dataset = await registerRawDataset({ store, fileStorage, userId, projectId, file, name: body.name, sheetName: body.sheet_name }); await store.updateFile(projectId, file.id, { category: "data", parse_note: "已登记为原始数据集；原始行不进入 AI 上下文。" }); await store.replaceFileChunks(projectId, file.id, []); finish(res, 201, { dataset: publicDataset(dataset) }, id); return; }
      if (segments.length === 5 && segments[2] === "datasets" && segments[4] === "crosstab-export" && req.method === "POST") { const dataset = await store.getDataset(projectId, segments[3]); if (!dataset) { finish(res, 404, errorPayload("数据集不存在。", "not_found", id), id); return; } const { exportCrosstabResults } = await dataEngineModule; const exported = await exportCrosstabResults({ store, fileStorage, userId, projectId, dataset }); finish(res, 201, { ...exported, file: publicFile(exported.file) }, id); return; }
      if (segments.length === 5 && segments[2] === "datasets" && ["profile", "clean", "weight", "crosstab"].includes(segments[4]) && req.method === "POST") { const mapping = { profile: "data_profile", clean: "data_clean", weight: "data_weight", crosstab: "crosstab" }; const dataset = await store.getDataset(projectId, segments[3]); if (!dataset) { finish(res, 404, errorPayload("数据集不存在。", "not_found", id), id); return; } const args = { ...body, idempotency_key: req.headers["idempotency-key"] || body.idempotency_key, dataset_id: dataset.id }; const threshold = integer(env.RESEARCH_DATA_ASYNC_CELL_THRESHOLD, 2_000_000, 100_000, 20_000_000); if (body.async === true || args.idempotency_key || body.confirmed === true || dataset.row_count * dataset.column_count >= threshold) { const job = await startProjectDataJob(userId, project, mapping[segments[4]], args); finish(res, 202, { job }, id); return; } const result = await runProjectDataTool(userId, project, mapping[segments[4]], args); finish(res, 201, result, id); return; }
      if (segments[2] === "data-jobs") {
        const { publicDataJob } = await dataJobsModule; await store.expireDataJobs();
        if (segments.length === 3 && req.method === 'GET') { finish(res,200,{jobs:(await store.listDataJobs(projectId)).map(publicDataJob)},id); return; }
        const job = segments.length === 5 && req.method === 'POST' && ['cancel','retry'].includes(segments[4]) ? await store.controlDataJob(projectId,segments[3],segments[4]) : segments.length === 4 && req.method === 'GET' ? await store.getDataJob(projectId,segments[3]) : null;
        if (!job) { finish(res,404,errorPayload('数据任务不存在。','not_found',id),id); return; }
        finish(res,200,{job:publicDataJob(job)},id); return;
      }
      if (segments.length === 3 && segments[2] === "cleaning-logs" && req.method === "GET") { finish(res, 200, { cleaning_logs: (await store.listCleaningLogs(projectId)).map((item) => publicRecord(item, ["rules", "summary"])) }, id); return; }
      if (segments.length === 3 && segments[2] === "analysis-results" && req.method === "GET") { finish(res, 200, { analysis_results: (await store.listAnalysisResults(projectId)).map((item) => publicRecord(item, ["input", "result", "compact_result"])) }, id); return; }
      if (segments.length === 3 && segments[2] === "evidence" && req.method === "GET") { finish(res, 200, { evidence: (await store.listEvidence(projectId, { query: requestUrl.searchParams.get("q"), type: requestUrl.searchParams.get("type"), theme: requestUrl.searchParams.get("theme"), limit: integer(requestUrl.searchParams.get("limit"), 200, 1, 200) })).map((item) => publicRecord(item, ["value", "metadata"])) }, id); return; }
      if (segments.length === 4 && segments[2] === "evidence" && req.method === "GET") { const evidence = await store.getEvidence(projectId, segments[3]); if (!evidence) { finish(res, 404, errorPayload("证据不存在。", "not_found", id), id); return; } let source = null; if (evidence.source_type === "crosstab") source = await store.getAnalysisResult(projectId, evidence.source_id); else if (evidence.source_type === "tool_result") source = (await store.listToolResults(projectId)).find((item) => item.id === evidence.source_id) || null; else if (evidence.source_type === "file") source = await store.getFile(projectId, evidence.source_id); else if (evidence.source_type === "artifact") source = await store.getArtifact(projectId, evidence.source_id); else if (evidence.source_type === "transcript_segment") { const value = parsedObject(evidence.value); source = value.transcript_id ? await store.getTranscriptSegment(projectId, value.transcript_id, evidence.source_id) : null; } finish(res, 200, { evidence: publicRecord(evidence, ["value", "metadata"]), source: source ? publicRecord(source, ["input", "result", "compact_result", "metadata"]) : null }, id); return; }
      if (segments.length === 4 && segments[2] === "evidence" && req.method === "PATCH") { const evidence = await store.updateEvidence(projectId, segments[3], body); if (!evidence) { finish(res, 404, errorPayload("证据不存在。", "not_found", id), id); return; } finish(res, 200, { evidence: publicRecord(evidence, ["value", "metadata"]) }, id); return; }
      if (segments.length === 3 && segments[2] === "transcripts" && req.method === "GET") { finish(res, 200, { transcripts: (await store.listTranscripts(projectId)).map(publicTranscript) }, id); return; }
      if (segments.length === 5 && segments[2] === "transcripts" && segments[4] === "summary" && req.method === "POST") {
        const transcript = await store.getTranscript(projectId, segments[3]);
        if (!transcript) { finish(res, 404, errorPayload("访谈不存在。", "not_found", id), id); return; }
        if (transcript.status !== "ready") { finish(res, 409, errorPayload("访谈尚未完成解析。", "transcript_not_ready", id), id); return; }
        const cacheReady = !body.force && transcript.summary_status === "ready" && transcript.deep_summary && transcript.summary_source_fingerprint === transcript.source_fingerprint;
        if (!cacheReady && !transcriptSummaryHarnessAdapter.isConfigured()) { finish(res, 503, errorPayload("单访谈深度摘要模型尚未配置。", "harness_not_configured", id), id); return; }
        if (!cacheReady) checkUsage(userId);
        const qualitativeTools = await qualitativeAnalysisModule; const summaryEnv = transcriptSummaryHarnessEnv(env);
        const result = await qualitativeTools.generateTranscriptDeepSummary({
          store, projectId, transcriptId: transcript.id, force: Boolean(body.force),
          model: `${String(summaryEnv.HARNESS_MODEL_PROVIDER || "default")}/${String(summaryEnv.HARNESS_MODEL || "default")}`,
          maxSourceChars: integer(env.RESEARCH_TRANSCRIPT_SUMMARY_MAX_SOURCE_CHARS, 120_000, 12_000, 240_000),
          maxSummaryChars: integer(env.RESEARCH_TRANSCRIPT_SUMMARY_MAX_CHARS, 20_000, 2_000, 40_000),
          targetChars: integer(env.RESEARCH_TRANSCRIPT_SUMMARY_TARGET_CHARS, 4_000, 1_200, 8_000),
          generate: async (prompt) => {
            const sessionId = await transcriptSummaryHarnessAdapter.createSession({ title: `访谈深度摘要 · ${transcript.respondent_label || transcript.title}`, requestId: id });
            return transcriptSummaryHarnessAdapter.sendMessage({ sessionId, prompt, requestId: id, forbidTools: true, timeoutMs: integer(summaryEnv.HARNESS_TIMEOUT, 180_000, 1, 300_000) });
          },
        });
        finish(res, 200, { transcript: publicTranscript(result.transcript), cached: result.cached, busy: result.busy }, id); return;
      }
      if (segments.length === 4 && segments[2] === "transcripts" && req.method === "PATCH") { const transcript = await store.getTranscript(projectId, segments[3]); if (!transcript) { finish(res, 404, errorPayload("访谈不存在。", "not_found", id), id); return; } const interviewType = String(body.interview_type || "").trim(); if (interviewType && !["expert", "consumer", "internal", "other"].includes(interviewType)) { finish(res, 400, errorPayload("访谈类型无效。", "invalid_request", id), id); return; } const updated = await store.updateTranscript(projectId, transcript.id, { ...(interviewType ? { interview_type: interviewType } : {}), ...(Object.prototype.hasOwnProperty.call(body, "respondent_label") ? { respondent_label: String(body.respondent_label || "").slice(0, 300) } : {}), ...(Object.prototype.hasOwnProperty.call(body, "respondent_metadata") ? { respondent_metadata: body.respondent_metadata } : {}) }); finish(res, 200, { transcript: publicTranscript(updated) }, id); return; }
      if (segments.length === 6 && segments[2] === "transcripts" && segments[4] === "segments" && req.method === "GET") { const { transcriptRead } = await qualitativeAnalysisModule; const context = await transcriptRead({ store, projectId, transcriptId: segments[3], segmentId: segments[5], contextBefore: requestUrl.searchParams.get("before"), contextAfter: requestUrl.searchParams.get("after") }); finish(res, 200, { context }, id); return; }
      if (segments.length === 3 && segments[2] === "transcript-versions" && req.method === "GET") { const transcriptId = String(requestUrl.searchParams.get("transcript_id") || "").trim(); if (transcriptId && !await store.getTranscript(projectId, transcriptId)) { finish(res, 404, errorPayload("访谈不存在。", "not_found", id), id); return; } finish(res, 200, { versions: (await store.listTranscriptVersions(projectId, transcriptId)).map((item) => publicRecord(item, ["terminology"])) }, id); return; }
      if (segments.length === 4 && segments[2] === "transcript-versions" && req.method === "GET") { const version = await store.getTranscriptVersion(projectId, segments[3]); if (!version) { finish(res, 404, errorPayload("笔录版本不存在。", "not_found", id), id); return; } const [versionSegments, corrections] = await Promise.all([store.listTranscriptVersionSegments(projectId, version.id), store.listTranscriptCorrections(projectId, version.id)]); finish(res, 200, { version: publicRecord(version, ["terminology"]), segments: versionSegments, corrections }, id); return; }
      if (segments.length === 4 && segments[2] === "transcript-corrections" && req.method === "PATCH") { const { resolveTranscriptCorrection } = await transcriptCorrectionModule; const result = await resolveTranscriptCorrection({ store, projectId, correctionId: segments[3], decision: String(body.decision || "") }); if (!result) { finish(res, 404, errorPayload("校正记录不存在。", "not_found", id), id); return; } finish(res, 200, { correction: result.correction, version: publicRecord(result.version, ["terminology"]), idempotent: result.idempotent }, id); return; }
      if (segments.length === 3 && segments[2] === "transcript-corrections" && req.method === "POST") {
        const transcriptIds = [...new Set((Array.isArray(body.transcript_ids) ? body.transcript_ids : []).map(String).filter(Boolean))];
        if (!transcriptIds.length) { finish(res, 400, errorPayload("请选择至少一份访谈笔录。", "transcripts_required", id), id); return; }
        if (!transcriptCorrectionHarnessAdapter.isConfigured()) { finish(res, 503, errorPayload("笔录校正模型尚未配置。", "harness_not_configured", id), id); return; }
        const maximum = integer(env.RESEARCH_TRANSCRIPT_CORRECTION_MAX_FILES, 10, 1, 20); if (transcriptIds.length > maximum) { finish(res, 400, errorPayload(`一次最多校正 ${maximum} 份笔录。`, "transcript_correction_limit", id), id); return; }
        for (const transcriptId of transcriptIds) if (!await store.getTranscript(projectId, transcriptId)) { finish(res, 404, errorPayload("所选访谈不存在。", "not_found", id), id); return; }
        checkUsage(userId); const clientRequestId = String(body.client_request_id || id); const existing = await store.findWorkflowByRequest(projectId, clientRequestId); if (existing) { const { publicWorkflow } = await researchPlanWorkflowModule; finish(res, 200, { workflow: publicWorkflow(existing), idempotent_replay: true }, id); return; }
        const correctionTools = await transcriptCorrectionModule; const { publicWorkflow } = await researchPlanWorkflowModule; const correctionEnv = transcriptCorrectionHarnessEnv(env); const startedAt = Date.now(); let workflow = await store.createWorkflow(projectId, { client_request_id: clientRequestId, task_type: "transcript_correction", constraints: { transcript_ids: transcriptIds } });
        workflow = await store.updateWorkflow(projectId, workflow.id, { status: "running", started_at: new Date().toISOString(), stages: correctionTools.transcriptCorrectionWorkflowStages.map((stage, index) => ({ ...stage, status: index === 0 ? "running" : "pending" })) });
        const results = await correctionTools.runTranscriptCorrectionBatch({ transcriptIds, concurrency: integer(env.TRANSCRIPT_CORRECTION_CONCURRENCY, 2, 1, 4), runOne: async (transcriptId) => { const transcript = await store.getTranscript(projectId, transcriptId); const sessionId = await transcriptCorrectionHarnessAdapter.createSession({ title: `笔录校正：${transcript.title}`, requestId: id }); return correctionTools.runTranscriptCorrection({ store, projectId, project, transcriptId, model: `${String(correctionEnv.HARNESS_MODEL_PROVIDER || "default")}/${String(correctionEnv.HARNESS_MODEL || "default")}`, batchSize: integer(env.RESEARCH_TRANSCRIPT_CORRECTION_BATCH_SEGMENTS, 4, 1, 8), contextSize: integer(env.RESEARCH_TRANSCRIPT_CORRECTION_CONTEXT_SEGMENTS, 1, 0, 2), generate: (prompt, meta) => transcriptCorrectionHarnessAdapter.sendMessage({ sessionId, prompt, requestId: `${id}:${meta.batchIndex}`, forbidTools: true, timeoutMs: integer(correctionEnv.HARNESS_TIMEOUT, 120_000, 1, 300_000) }) }); } });
        const successes = results.filter((item) => item.ok); const failures = results.filter((item) => !item.ok); const status = successes.length ? "completed" : "failed"; const quality = { file_count: results.length, completed_files: successes.length, failed_files: failures.length, auto_applied_count: successes.reduce((sum, item) => sum + Number(item.result.version.auto_applied_count || 0), 0), pending_review_count: successes.reduce((sum, item) => sum + Number(item.result.version.pending_review_count || 0), 0), versions: successes.map((item) => ({ transcript_id: item.transcript_id, version_id: item.result.version.id, version: item.result.version.version, status: item.result.version.status })), failures: failures.map((item) => ({ transcript_id: item.transcript_id, error: item.error })) };
        workflow = await store.updateWorkflow(projectId, workflow.id, { status, quality, stages: correctionTools.transcriptCorrectionWorkflowStages.map((stage) => ({ ...stage, status: status === "completed" ? "completed" : stage.id === "complete" ? "failed" : "completed" })), error: quality.failures.map((item) => item.error).join("；"), completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt }); finish(res, 200, { workflow: publicWorkflow(workflow), results: quality.versions, failures: quality.failures }, id); return;
      }
      if (segments.length === 3 && segments[2] === "insights" && req.method === "GET") { const artifactId = String(requestUrl.searchParams.get("artifact_id") || "").trim(); finish(res, 200, { insights: (await store.listResearchInsights(projectId, artifactId)).map((item) => publicRecord(item, ["metadata"])) }, id); return; }
      if (segments.length === 4 && segments[2] === "insights" && req.method === "PATCH") { const insight = await store.updateResearchInsight(projectId, segments[3], body); if (!insight) { finish(res, 404, errorPayload("洞察不存在。", "not_found", id), id); return; } finish(res, 200, { insight: publicRecord(insight, ["metadata"]) }, id); return; }
      if (segments.length === 4 && segments[2] === "memory" && segments[3] === "search" && req.method === "GET") { const query = String(requestUrl.searchParams.get("q") || "").trim(); if (!query) { finish(res, 400, errorPayload("请输入检索词。", "invalid_request", id), id); return; } const files = await store.listFiles(projectId); const { searchProjectChunks } = await memoryModule; const matches = searchProjectChunks(await projectChunks(projectId, files), files, query, { limit: integer(requestUrl.searchParams.get("limit"), 8, 1, 12) }).map((item) => ({ ...item, content: String(item.content).slice(0, 1_600) })); finish(res, 200, { query, matches }, id); return; }
      if (segments.length === 3 && segments[2] === "workflows" && req.method === "GET") { const { publicWorkflow } = await researchPlanWorkflowModule; finish(res, 200, { workflows: (await store.listWorkflows(projectId)).map(publicWorkflow) }, id); return; }
      if (segments.length === 4 && segments[2] === "workflows" && req.method === "GET") { const { publicWorkflow } = await researchPlanWorkflowModule; const workflow = await store.getWorkflow(projectId, segments[3]); if (!workflow) finish(res, 404, errorPayload("工作流记录不存在。", "not_found", id), id); else finish(res, 200, { workflow: publicWorkflow(workflow) }, id); return; }
      if (segments.length === 3 && segments[2] === "messages" && req.method === "GET") { finish(res, 200, { messages: await store.listMessages(projectId) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 3 && segments[2] === "messages" && req.method === "POST") {
        const result = await sendResearchMessage(userId, project, body, id); finish(res, 200, result, id); log(200, "success", { project_id: projectId, session_recreated: result.session_recreated, idempotent_replay: result.idempotent_replay }); return;
      }
      if (segments.length === 3 && segments[2] === "artifacts" && req.method === "GET") { const artifacts = await store.listArtifacts(projectId); const latestEvidenceAt = (await store.listEvidence(projectId, { limit: 200 })).map((item) => item.updated_at || item.created_at).filter(Boolean).sort().at(-1) || null; finish(res, 200, { artifacts: artifacts.map((item) => { if (item.type !== "report_outline") return item; const outline = parsedObject(item.content); const snapshotAt = outline.evidence_snapshot?.latest_evidence_at || outline.evidence_snapshot?.captured_at || item.created_at; return { ...item, has_new_evidence: Boolean(latestEvidenceAt && snapshotAt && latestEvidenceAt > snapshotAt), evidence_snapshot_at: snapshotAt }; }) }, id); log(200, "success", { project_id: projectId }); return; }
      if (segments.length === 5 && segments[2] === "artifacts" && segments[4] === "compare" && req.method === "GET") { const target = await store.getArtifact(projectId, segments[3]); if (!target) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); return; } const baseId = String(requestUrl.searchParams.get("with") || target.parent_artifact_id || ""); const base = baseId ? await store.getArtifact(projectId, baseId) : null; if (!base) { finish(res, 409, errorPayload("该成果没有可对比的父版本。", "comparison_unavailable", id), id); return; } const { compareArtifacts } = await diffModule; finish(res, 200, { comparison: compareArtifacts(base, target) }, id); return; }
      if (segments.length === 3 && segments[2] === "artifacts" && req.method === "POST") {
        if (!ARTIFACT_TYPES.has(body.type) || !String(body.title || "").trim() || !String(body.content || "").trim()) { finish(res, 400, errorPayload("成果类型、标题或内容无效。", "invalid_request", id), id); log(400, "error"); return; }
        if (body.parent_artifact_id) { const parent = await store.getArtifact(projectId, String(body.parent_artifact_id)); if (!parent || parent.type !== body.type) { finish(res, 404, errorPayload("父版本成果不存在或类型不一致。", "not_found", id), id); return; } }
        if (body.type === "report_outline") { const reportTools = await reportStorylineModule; const scope = reportTools.validateReportOutlineEvidenceScope(body.content, await store.listEvidence(projectId, { limit: 200 })); if (!scope.valid) { finish(res, 400, errorPayload("报告大纲包含无效、已排除或不属于当前项目的 Evidence 引用。", "invalid_evidence_scope", id), id); return; } }
        if (body.type === "ppt_script") { const scriptTools = await pptScriptWorkflowModule; const scope = scriptTools.validatePptScriptEvidenceScope(body.content, await store.listEvidence(projectId, { limit: 200 })); const sourceOutline = scope.source_report_outline_id ? await store.getArtifact(projectId, scope.source_report_outline_id) : null; if (!scope.valid || !sourceOutline || sourceOutline.type !== "report_outline") { finish(res, 400, errorPayload("PPT Script 包含无效 Evidence、数据来源、报告大纲来源或无法回溯的原声。", "invalid_ppt_script_evidence", id), id); return; } }
        if (body.type === "qualitative_ppt") { const metadata = parsedObject(body.content); const sourceScript = await store.getArtifact(projectId, String(metadata.source_ppt_script || "")); const sourceOutline = await store.getArtifact(projectId, String(metadata.source_report_outline || "")); const analysisIds = Array.isArray(metadata.source_analysis_artifacts) ? metadata.source_analysis_artifacts : []; const analyses = await Promise.all(analysisIds.map((artifactId) => store.getArtifact(projectId, String(artifactId)))); const file = await store.getFile(projectId, String(metadata.file_id || "")); if (!sourceScript || sourceScript.type !== "ppt_script" || !sourceOutline || sourceOutline.type !== "report_outline" || !analysisIds.length || analyses.some((item) => !item || item.type !== "qualitative_analysis") || !file || file.file_type !== "pptx") { finish(res, 400, errorPayload("定性 PPT 的 Analysis、Outline、PPT Script 或项目文件来源无效。", "invalid_qualitative_ppt_lineage", id), id); return; } }
        finish(res, 201, { artifact: await store.createArtifact(projectId, body) }, id); log(201, "success", { project_id: projectId }); return;
      }
      if (segments.length === 4 && segments[2] === "artifacts" && req.method === "PATCH") { const existing = await store.getArtifact(projectId, segments[3]); if (!existing) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); return; } if (existing.type === "report_outline" && Object.prototype.hasOwnProperty.call(body, "content")) { const reportTools = await reportStorylineModule; const scope = reportTools.validateReportOutlineEvidenceScope(body.content, await store.listEvidence(projectId, { limit: 200 })); if (!scope.valid) { finish(res, 400, errorPayload("报告大纲包含无效、已排除或不属于当前项目的 Evidence 引用。", "invalid_evidence_scope", id), id); return; } } if (existing.type === "ppt_script" && Object.prototype.hasOwnProperty.call(body, "content")) { const scriptTools = await pptScriptWorkflowModule; const scope = scriptTools.validatePptScriptEvidenceScope(body.content, await store.listEvidence(projectId, { limit: 200 })); const sourceOutline = scope.source_report_outline_id ? await store.getArtifact(projectId, scope.source_report_outline_id) : null; if (!scope.valid || !sourceOutline || sourceOutline.type !== "report_outline") { finish(res, 400, errorPayload("PPT Script 包含无效 Evidence、数据来源、报告大纲来源或无法回溯的原声。", "invalid_ppt_script_evidence", id), id); return; } } const artifact = await store.updateArtifact(projectId, segments[3], body); finish(res, 200, { artifact }, id); log(200, "success"); return; }
      if (segments.length === 4 && segments[2] === "artifacts" && req.method === "DELETE") { const deleted = await store.deleteArtifact(projectId, segments[3]); if (!deleted) { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); } else { res.writeHead(204, { "Cache-Control": "no-store", "X-Research-Request-ID": id }); res.end(); log(204, "success"); } return; }
      finish(res, 405, errorPayload("Method not allowed", "method_not_allowed", id), id); log(405, "error");
    } catch (error) {
      if (error.code === "INVALID" || error.code === "INVALID_JSON") { finish(res, 400, errorPayload("请求内容无效。", "invalid_request", id), id); log(400, "error"); return; }
      if (error.code === "TOO_LARGE") { finish(res, 413, errorPayload("请求内容过大。", "invalid_request", id), id); log(413, "error"); return; }
      if (error.code === "FILE_TOO_LARGE") { finish(res, 413, errorPayload("文件过大。", "file_too_large", id), id); log(413, "error"); return; }
      if (error.code === "FILE_NOT_FOUND") { finish(res, 404, errorPayload("所选项目文件不存在。", "not_found", id), id); log(404, "error"); return; }
      if (error.code === "DATASET_REQUIRED") { finish(res, 400, errorPayload("请先上传并选择一个可用数据集。", "dataset_required", id), id); log(400, "error"); return; }
      if (error.code === "TRANSCRIPTS_REQUIRED") { finish(res, 400, errorPayload("请先上传至少一份已成功解析的访谈材料。", "transcripts_required", id), id); log(400, "error"); return; }
      if (error.code === "TRANSCRIPT_CORRECTION_LIMIT") { finish(res, 400, errorPayload(error.message, "transcript_correction_limit", id), id); log(400, "error"); return; }
      if (["TRANSCRIPT_CORRECTION_JSON_INVALID", "TRANSCRIPT_CORRECTION_SCHEMA_INVALID"].includes(error.code)) { finish(res, 502, errorPayload("笔录校正模型返回结构不完整，请重试。", "transcript_correction_invalid_response", id, true), id); log(502, "error"); return; }
      if (error.code === "TRANSCRIPT_CORRECTION_CONFLICT") { finish(res, 409, errorPayload(error.message, "transcript_correction_conflict", id), id); log(409, "error"); return; }
      if (error.code === "INTERVIEW_SUMMARY_SCOPE") { finish(res, 400, errorPayload("单篇访谈小结必须且只能选择一份已解析访谈。", "interview_summary_scope", id), id); log(400, "error"); return; }
      if (["TRANSCRIPT_NOT_FOUND", "TRANSCRIPT_SEGMENT_NOT_FOUND"].includes(error.code)) { finish(res, 404, errorPayload(error.message || "访谈证据不存在。", "not_found", id), id); log(404, "error"); return; }
      if (error.code === "DATASET_CONTEXT_FORBIDDEN") { finish(res, 400, errorPayload("原始数据文件不能作为普通 AI 上下文，请在数据集区选择数据版本。", "dataset_context_forbidden", id), id); log(400, "error"); return; }
      if (error.code === "CROSSTAB_EXPORT_EMPTY") { finish(res, 409, errorPayload(error.message, "crosstab_export_empty", id), id); log(409, "error"); return; }
      if (String(error.code || "").startsWith("DATASET_") || String(error.code || "").startsWith("WEIGHT_") || ["FIELD_NOT_FOUND", "CROSSTAB_INPUT_REQUIRED", "CLEANING_RULES_REQUIRED", "CLEANING_RULE_UNSUPPORTED", "CROSSTAB_CARDINALITY_HIGH"].includes(error.code)) { finish(res, 400, errorPayload(error.message || "数据工具输入无效。", "data_tool_input", id), id); log(400, "error"); return; }
      if (error.code === "QUALITATIVE_EXCEL_INPUT") { finish(res, 400, errorPayload(error.message, "qualitative_excel_input", id), id); log(400, "error"); return; }
      if (["QUALITATIVE_EXCEL_JSON_INVALID", "QUALITATIVE_EXCEL_SCHEMA_INVALID"].includes(error.code)) { finish(res, 502, errorPayload("Harness 返回的逐题小结格式不完整，请重试。", "qualitative_excel_invalid_response", id, true), id); log(502, "error"); return; }
      if (error.code === "RATE_LIMIT") { finish(res, 429, errorPayload("AI 研究员请求过于频繁，请稍后再试。", "rate_limited", id, true), id); log(429, "error"); return; }
      if (error.code === "NOT_FOUND") { finish(res, 404, errorPayload("成果不存在。", "not_found", id), id); log(404, "error"); return; }
      if (error.code === "CONFLICT") { finish(res, 409, errorPayload("项目标识已存在。", "conflict", id), id); log(409, "error"); return; }
      const sanitized = sanitizeHarnessError(error, id); finish(res, sanitized.status, sanitized.body, id); log(sanitized.status, "error", { error_type: sanitized.body.error.type });
    }
  };
}

module.exports = { createResearchHandler, sanitizeHarnessError, fullContext };
