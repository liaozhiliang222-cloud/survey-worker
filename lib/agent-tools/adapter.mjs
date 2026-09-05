import { executeTool } from "../tools/registry.mjs";
import { ToolInputError } from "../tools/errors.mjs";
import { enqueueDataJob, executeDataJob } from "../data-jobs.mjs";
import { createTranscriptToolExecutor } from "../qualitative-analysis.mjs";

export const AGENT_TOOL_REGISTRY = Object.freeze({
  sample_size: Object.freeze({ agent_id: "sample_size", gateway_id: "sample-size", label: "样本量计算", running_text: "正在计算样本量…", completed_text: "已完成样本量计算" }),
  quota_design: Object.freeze({ agent_id: "quota_design", gateway_id: "quota", label: "配额设计", running_text: "正在生成配额方案…", completed_text: "已完成配额设计" }),
  questionnaire_check: Object.freeze({ agent_id: "questionnaire_check", gateway_id: "questionnaire-check", label: "问卷质检", running_text: "正在检查问卷…", completed_text: "已完成问卷质检" }),
  data_profile: Object.freeze({ agent_id: "data_profile", gateway_id: "data-profile", label: "数据结构检查", running_text: "正在读取数据结构…", completed_text: "数据检查完成" }),
  data_clean: Object.freeze({ agent_id: "data_clean", gateway_id: "data-clean", label: "数据清洗", running_text: "正在评估清洗规则…", completed_text: "清洗规则处理完成" }),
  data_weight: Object.freeze({ agent_id: "data_weight", gateway_id: "data-weight", label: "数据加权", running_text: "正在评估加权方案…", completed_text: "加权方案处理完成" }),
  crosstab: Object.freeze({ agent_id: "crosstab", gateway_id: "crosstab", label: "交叉表分析", running_text: "正在执行交叉分析…", completed_text: "交叉分析完成" }),
  transcript_search: Object.freeze({ agent_id: "transcript_search", gateway_id: "transcript-search", label: "访谈原声检索", running_text: "正在检索访谈原声…", completed_text: "访谈原声检索完成" }),
  transcript_read: Object.freeze({ agent_id: "transcript_read", gateway_id: "transcript-read", label: "访谈上下文回查", running_text: "正在回查原声上下文…", completed_text: "原声上下文回查完成" }),
});

export const AGENT_TOOL_PERMISSIONS = Object.freeze({
  "*": false,
  sample_size: true,
  quota_design: true,
  questionnaire_check: true,
  data_profile: true,
  data_clean: true,
  data_weight: true,
  crosstab: true,
  transcript_search: true,
  transcript_read: true,
});

export class AgentToolError extends Error {
  constructor(message, code = "AGENT_TOOL_ERROR", status = 400) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.status = status;
  }
}

function parsedRecordValue(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
}

function probability(value, fallback, field) {
  const raw = value == null || value === "" ? fallback : Number(value);
  const normalized = raw > 1 ? raw / 100 : raw;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) throw new ToolInputError(`${field}输入无效。`, "INVALID_INPUT", { field });
  return normalized;
}

function confidenceZ(confidence) {
  const supported = new Map([[0.8, 1.282], [0.85, 1.44], [0.9, 1.645], [0.95, 1.96], [0.98, 2.326], [0.99, 2.576], [0.995, 2.807]]);
  const match = [...supported.entries()].find(([level]) => Math.abs(level - confidence) < 0.00001);
  if (!match) throw new ToolInputError("置信水平仅支持 80%、85%、90%、95%、98%、99% 或 99.5%。", "INVALID_INPUT", { field: "confidence_level" });
  return match[1];
}

function sampleInput(args = {}) {
  const confidence = probability(args.confidence_level, 0.95, "confidence_level");
  const margin = probability(args.margin_of_error, 0.05, "margin_of_error");
  const responseRate = probability(args.response_rate, 0.8, "response_rate");
  return {
    z: confidenceZ(confidence),
    marginPercent: margin * 100,
    population: args.population ?? 0,
    segments: args.segments ?? 1,
    responseRatePercent: responseRate * 100,
    _agent_context: { confidence_level: confidence, margin_of_error: margin, response_rate: responseRate },
  };
}

function gatewayInput(agentToolId, args) {
  if (agentToolId === "sample_size") return sampleInput(args);
  if (agentToolId === "quota_design") return {
    mode: args?.mode || "single",
    total_sample: args?.total_sample,
    dimensions: args?.dimensions,
  };
  if (agentToolId === "questionnaire_check") return {
    text: args?.questionnaire_text ?? args?.text ?? "",
    scenario: args?.scenario || "general",
  };
  if (["data_profile", "data_clean", "data_weight", "crosstab", "transcript_search", "transcript_read"].includes(agentToolId)) return args && typeof args === "object" ? args : {};
  throw new AgentToolError("该专业工具未开放给 AI Researcher。", "AGENT_TOOL_NOT_ALLOWED", 404);
}

function compactSample(input, result, resultId) {
  return {
    result_id: resultId,
    recommended_sample: result.base,
    recommended_invites: result.gross,
    sample_per_segment: result.segment,
    confidence_level: input._agent_context.confidence_level,
    margin_of_error: input._agent_context.margin_of_error,
    response_rate: input._agent_context.response_rate,
  };
}

function compactQuota(result, resultId) {
  const dimensions = (result.dimensions || []).slice(0, 8).map((dimension) => ({
    name: dimension.name,
    groups: (dimension.groups || []).slice(0, 40).map((group) => ({ label: group.label, share: group.share, sample: group.sample })),
  }));
  const combinations = (result.flat || []).slice(0, 50).map((item) => ({ labels: item.labels, sample: item.sample }));
  return {
    result_id: resultId,
    mode: result.mode,
    total_sample: result.total_sample,
    dimensions,
    ...(result.mode === "cross" ? { combination_count: result.combination_count, combinations } : {}),
    truncated: (result.flat || []).length > combinations.length || (result.dimensions || []).some((dimension) => (dimension.groups || []).length > 40),
  };
}

function compactQuestionnaire(result, resultId) {
  return {
    result_id: resultId,
    summary: result.summary,
    question_count: result.question_count,
    scenario: result.scenario,
    key_issues: (result.issues || []).slice(0, 20).map((issue) => ({ type: issue.type, level: issue.level, question: issue.question, message: issue.message })),
    truncated: (result.issues || []).length > 20,
  };
}

export function compactAgentToolResult(agentToolId, input, result, resultId) {
  if (agentToolId === "sample_size") return compactSample(input, result, resultId);
  if (agentToolId === "quota_design") return compactQuota(result, resultId);
  if (agentToolId === "questionnaire_check") return compactQuestionnaire(result, resultId);
  return { result_id: resultId, ...result };
}

export function agentToolStatus(agentToolId, status, summary = "") {
  const tool = AGENT_TOOL_REGISTRY[agentToolId];
  if (!tool) return null;
  return { tool_id: agentToolId, label: tool.label, status, message: status === "running" ? tool.running_text : status === "completed" ? tool.completed_text : "专业工具调用未完成", ...(summary ? { summary: String(summary).slice(0, 240) } : {}) };
}

export async function executeAgentTool({ agentToolId, args, harnessSessionId, callId, requestId, store, fileStorage = null, dataJobRunner, logger = console }) {
  const tool = AGENT_TOOL_REGISTRY[agentToolId];
  if (!tool) throw new AgentToolError("该专业工具未开放给 AI Researcher。", "AGENT_TOOL_NOT_ALLOWED", 404);
  const sessionId = String(harnessSessionId || "").trim();
  const normalizedCallId = String(callId || "").trim().slice(0, 160);
  if (!sessionId || !normalizedCallId) throw new AgentToolError("Harness Session 或 Tool Call 标识缺失。", "INVALID_AGENT_CONTEXT", 400);
  const scope = await store.getProjectByHarnessSession(sessionId);
  if (!scope?.project?.id || !scope.user_id) throw new AgentToolError("未找到该 Harness Session 对应的 Research Project。", "AGENT_SESSION_NOT_FOUND", 404);
  const existing = await store.findToolResultByAgentCallId(scope.project.id, normalizedCallId);
  if (existing) {
    const savedInput = parsedRecordValue(existing.input);
    const savedResult = parsedRecordValue(existing.result);
    return { tool, project: scope.project, saved: existing, data: compactAgentToolResult(agentToolId, savedInput, savedResult, existing.id), replayed: true };
  }
  const input = gatewayInput(agentToolId, args || {});
  const started = Date.now();
  try {
    if (["data_profile", "data_clean", "data_weight", "crosstab"].includes(agentToolId)) {
      if (!fileStorage) throw new AgentToolError("数据工具存储尚未配置。", "DATA_STORAGE_NOT_CONFIGURED", 503);
      const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedCallId || crypto.randomUUID()));
      const requestKey = `agent:${Array.from(new Uint8Array(keyBytes), b => b.toString(16).padStart(2, '0')).join('')}`;
      const pending = await enqueueDataJob(store, scope.user_id, scope.project.id, agentToolId, input, requestKey, { agentCallId: normalizedCallId });
      const job = await store.getDataJob(scope.project.id, pending.id);
      // The job is durable before attempting inline execution. If this request
      // disappears, the consumer and project task list can recover its state.
      await executeDataJob({ store, fileStorage, job, runTool: dataJobRunner });
      const current = await store.getDataJob(scope.project.id, job.id);
      if (current.status !== 'completed') {
        if (['failed', 'cancelled'].includes(current.status)) throw new AgentToolError(`数据任务 ${current.id} ${current.status === 'cancelled' ? '已取消' : '失败，可在项目数据任务列表重试'}。`, 'DATA_JOB_INCOMPLETE', 409);
        return { tool, project: scope.project, saved: null, data: { job_id: current.id, status: current.status, message: '任务正在后台处理，请从项目数据任务列表查看结果，勿重复创建。' }, replayed: true };
      }
      const payload = JSON.parse(current.result);
      const saved = { ...payload.tool_result, input: JSON.stringify(payload.tool_result.input), result: JSON.stringify(payload.tool_result.result) };
      logger.log(JSON.stringify({ event: "agent_tool_call", request_id: requestId, project_id: scope.project.id, tool_id: agentToolId, dataset_id: input.dataset_id || null, duration_ms: Date.now() - started, outcome: "success" }));
      return { tool, project: scope.project, saved, data: { ...payload.data, tool_result_id: saved.id }, replayed: false };
    }
    if (["transcript_search", "transcript_read"].includes(agentToolId)) {
      const executed = await createTranscriptToolExecutor({ store })({ agentToolId, args: input, scope });
      const saved = await store.createToolResult(scope.user_id, scope.project.id, executed.gatewayId, executed.input, executed.compact, { source: "agent", agent_call_id: normalizedCallId });
      logger.log(JSON.stringify({ event: "agent_tool_call", request_id: requestId, project_id: scope.project.id, tool_id: agentToolId, duration_ms: Date.now() - started, outcome: "success" }));
      return { tool, project: scope.project, saved, data: { ...executed.compact, tool_result_id: saved.id }, replayed: false };
    }
    const executed = executeTool(tool.gateway_id, input);
    const saved = await store.createToolResult(scope.user_id, scope.project.id, tool.gateway_id, input, executed.data, { source: "agent", agent_call_id: normalizedCallId });
    logger.log(JSON.stringify({ event: "agent_tool_call", request_id: requestId, project_id: scope.project.id, tool_id: agentToolId, duration_ms: Date.now() - started, outcome: "success" }));
    return { tool, project: scope.project, saved, data: compactAgentToolResult(agentToolId, input, executed.data, saved.id), replayed: false };
  } catch (error) {
    logger.error(JSON.stringify({ event: "agent_tool_call", request_id: requestId, project_id: scope.project.id, tool_id: agentToolId, duration_ms: Date.now() - started, outcome: "failure", error_type: String(error?.code || "unknown") }));
    throw error;
  }
}
