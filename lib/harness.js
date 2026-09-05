"use strict";

const { randomUUID } = require("crypto");

const DEFAULT_TIMEOUT_MS = 120_000;
const CANCEL_TIMEOUT_MS = 5_000;
const MAX_REPLY_CHARS = 2 * 1024 * 1024;
const SUPPORTED_STYLES = new Set(["opencode", "dsh-rpc", "openai-chat"]);
const INTERACTIVE_TOOL_NAMES = new Set(["ask_user_question", "request_user_input"]);
const DIRECT_REPLY_RETRY_PROMPT = "【强制正文直出重试】上一轮因尝试调用工具已被系统取消。不要调用任何工具，不要创建或读取文件，不要解释执行过程；请基于上一条用户要求，立即在本轮回复正文中给出完整成果。";
const CONTINUATION_PROMPT = "继续上一条因达到输出 token 上限而中断的回答。请从最后一个字符之后直接续写，仅输出尚未完成的剩余正文；不要复述已有内容，不要解释，不要添加‘继续’或‘续写’等前缀。";
const HISTORY_POLL_MIN_MS = 10_000;
const RESEARCH_TOOL_NAMES = new Set(["sample_size", "quota_design", "questionnaire_check", "data_profile", "data_clean", "data_weight", "crosstab", "transcript_search", "transcript_read"]);
const RESEARCH_TOOL_PERMISSIONS = Object.freeze({ "*": false, sample_size: true, quota_design: true, questionnaire_check: true, data_profile: true, data_clean: true, data_weight: true, crosstab: true, transcript_search: true, transcript_read: true });
const RESEARCH_TOOL_LABELS = Object.freeze({ sample_size: "样本量计算", quota_design: "配额设计", questionnaire_check: "问卷质检", data_profile: "数据结构检查", data_clean: "数据清洗", data_weight: "数据加权", crosstab: "交叉表分析", transcript_search: "访谈原声检索", transcript_read: "访谈上下文回查" });
const RESEARCH_TOOL_RUNNING = Object.freeze({ sample_size: "正在计算样本量…", quota_design: "正在生成配额方案…", questionnaire_check: "正在检查问卷…", data_profile: "正在读取数据结构…", data_clean: "正在评估清洗规则…", data_weight: "正在评估加权方案…", crosstab: "正在执行交叉分析…", transcript_search: "正在检索访谈原声…", transcript_read: "正在回查原声上下文…" });
const OPENAI_RESEARCH_TOOL_DEFINITIONS = Object.freeze({
  sample_size: { description: "根据置信水平、误差范围和总体规模计算确定性调研样本量。", properties: { confidence_level: { type: "number" }, margin_of_error: { type: "number" }, population: { type: "integer" }, response_rate: { type: "number" }, segments: { type: "integer" } } },
  quota_design: { description: "按总样本及明确比例生成确定性整数配额。", properties: { mode: { type: "string", enum: ["single", "cross"] }, total_sample: { type: "integer" }, dimensions: { type: "array", items: { type: "object" } } }, required: ["total_sample", "dimensions"] },
  questionnaire_check: { description: "检查问卷结构、跳转逻辑和选项规则。", properties: { questionnaire_text: { type: "string" }, scenario: { type: "string" } }, required: ["questionnaire_text"] },
  data_profile: { description: "读取项目数据集结构、字段索引和质量问题。", properties: { dataset_id: { type: "string" }, field_query: { type: "array", items: { type: "string" } }, field_limit: { type: "integer" } }, required: ["dataset_id"] },
  data_clean: { description: "预估或执行确定性数据清洗；高影响操作必须先预估再确认。", properties: { dataset_id: { type: "string" }, confirmed: { type: "boolean" }, name: { type: "string" }, rules: { type: "array", items: { type: "object" } } }, required: ["dataset_id", "rules", "confirmed"] },
  data_weight: { description: "按用户明确提供的总体分布预估或执行 RIM 加权。", properties: { dataset_id: { type: "string" }, method: { type: "string", enum: ["rim"] }, confirmed: { type: "boolean" }, name: { type: "string" }, targets: { type: "array", items: { type: "object" } } }, required: ["dataset_id", "method", "targets", "confirmed"] },
  crosstab: { description: "对项目数据集执行确定性交叉分析、NPS 或均值分组汇总。", properties: { dataset_id: { type: "string" }, banner: { type: "array", items: { type: "string" } }, variables: { type: "array", items: { type: "string" } } }, required: ["dataset_id", "banner", "variables"] },
  transcript_search: { description: "在当前项目访谈 Segment 中检索相关原声；结果只用于定位。", properties: { query: { type: "string" }, filters: { type: "object" }, transcript_ids: { type: "array", items: { type: "string" } }, limit: { type: "integer" } }, required: ["query"] },
  transcript_read: { description: "按 Transcript ID 和 Segment ID 回查逐字原文及前后文。", properties: { transcript_id: { type: "string" }, segment_id: { type: "string" }, context_before: { type: "integer" }, context_after: { type: "integer" } }, required: ["transcript_id", "segment_id"] },
});

function harnessError(code, options = {}) {
  const error = new Error(code);
  error.name = "HarnessError";
  error.code = code;
  error.status = Number(options.status || 0);
  error.retryable = Boolean(options.retryable);
  return error;
}

function timeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(300_000, Math.max(1, Math.round(parsed))) : DEFAULT_TIMEOUT_MS;
}

function pollIntervalMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(10_000, Math.max(100, Math.round(parsed))) : 1_000;
}

function continuationLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0, Math.round(parsed))) : 3;
}

function toolCallLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(10, Math.max(1, Math.round(parsed))) : 5;
}

function promptTools(options = {}) {
  if (options.forbidTools) return { "*": false };
  if (!options.researchTools) return undefined;
  const allowed = Array.isArray(options.allowedResearchTools) ? new Set(options.allowedResearchTools.map(String)) : RESEARCH_TOOL_NAMES;
  return Object.fromEntries(Object.keys(RESEARCH_TOOL_PERMISSIONS).map((name) => [name, name === "*" ? false : allowed.has(name)]));
}

function toolCallIdentity(event) {
  const data = event?.data || {};
  return String(data.callId || data.call_id || data.id || `${data.name || "tool"}:${event?.seq ?? "unknown"}`);
}

function observeToolEvent(event, options, state) {
  if (event?.type !== "tool/call") return { blocked: false, limitExceeded: false };
  const name = String(event.data?.name || "");
  if (options.forbidTools) return { blocked: true, limitExceeded: false };
  if (!options.researchTools) return { blocked: false, limitExceeded: false };
  if (!RESEARCH_TOOL_NAMES.has(name)) return { blocked: true, limitExceeded: false };
  if (Array.isArray(options.allowedResearchTools) && !options.allowedResearchTools.includes(name)) return { blocked: true, limitExceeded: false };
  const callId = toolCallIdentity(event);
  if (!state.calls.has(callId)) {
    state.calls.set(callId, name);
    options.onToolStatus?.({ tool_id: name, label: RESEARCH_TOOL_LABELS[name], status: "running", message: RESEARCH_TOOL_RUNNING[name] || "正在调用专业工具…" });
  }
  return { blocked: false, limitExceeded: state.calls.size > state.maximum };
}

function completeObservedTools(options, state, status = "completed") {
  for (const [callId, name] of state.calls) {
    if (state.completed.has(callId)) continue;
    state.completed.add(callId);
    options.onToolStatus?.({ tool_id: name, label: RESEARCH_TOOL_LABELS[name], status, message: status === "completed" ? `已完成${RESEARCH_TOOL_LABELS[name]}` : "专业工具调用未完成" });
  }
}

function isMaxTokensReason(reason) {
  return String(reason?.kind || "").trim().toLowerCase() === "max-tokens";
}

function extractSessionId(payload) {
  return String(payload?.id || payload?.session?.id || payload?.data?.id || "").trim();
}

function extractReply(payload) {
  const parts = payload?.parts || payload?.message?.parts || payload?.data?.parts || payload?.data?.message?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim().slice(0, MAX_REPLY_CHARS);
}

function extractOpenAiReply(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content === "string") return content.trim().slice(0, MAX_REPLY_CHARS);
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" || part?.type === "output_text")
    .map((part) => String(part?.text || ""))
    .join("\n")
    .trim()
    .slice(0, MAX_REPLY_CHARS);
}

function openAiReachedTokenLimit(payload) {
  const reason = String(payload?.choices?.[0]?.finish_reason || "").trim().toLowerCase();
  return reason === "length" || reason === "max_tokens";
}

function promptExpectsJson(prompt) {
  return /只输出\s*JSON|输出必须只有一个\s*JSON|strict\s+JSON|JSON\s*(?:对象|数组)/i.test(String(prompt || ""));
}

function extractDshReply(events) {
  const messages = events.filter((entry) => entry?.event?.type === "assistant/message");
  const content = messages.at(-1)?.event?.data?.message?.content;
  if (Array.isArray(content)) {
    const reply = content.filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text).join("\n").trim();
    if (reply) return reply.slice(0, MAX_REPLY_CHARS);
  }
  return events.filter((entry) => entry?.event?.type === "assistant/chunk")
    .map((entry) => entry.event.data?.chunk)
    .filter(isDshTextChunk)
    .map((chunk) => chunk.text).join("").trim().slice(0, MAX_REPLY_CHARS);
}

function isDshTextChunk(chunk) {
  if (typeof chunk?.text !== "string") return false;
  const type = String(chunk.type || "").trim().toLowerCase();
  return !["reasoning", "analysis", "thinking"].some((marker) => type.includes(marker));
}

function interactiveToolCall(events) {
  return events.filter((entry) => entry?.event?.type === "tool/call" && INTERACTIVE_TOOL_NAMES.has(String(entry.event.data?.name || ""))).at(-1) || null;
}

function dshFailure(error) {
  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.status || error?.details?.status || error?.details?.error?.status || 0);
  if (status === 429 || code === "quota" || code.includes("rate-limit")) return harnessError("HARNESS_UPSTREAM", { status: 429, retryable: true });
  if (code.includes("agent-preset-locked")) return harnessError("HARNESS_UPSTREAM", { status: 410, retryable: true });
  if (status === 404 || status === 410 || code.includes("session-not-found") || code.includes("session-removed")) return harnessError("HARNESS_UPSTREAM", { status: 410, retryable: true });
  return harnessError("HARNESS_UPSTREAM", { status: status || 502, retryable: status >= 500 });
}

function createHarnessAdapter({ env = process.env, fetchImpl = globalThis.fetch, logger = console, executeTool = null } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Harness adapter requires fetch.");
  const baseUrl = String(env.HARNESS_BASE_URL || "").trim().replace(/\/+$/, "");
  const style = String(env.HARNESS_API_STYLE || "opencode").trim().toLowerCase();
  const selectedDshSessions = new Set();
  const selectedDshPresets = new Set();
  if (!SUPPORTED_STYLES.has(style)) throw new Error("Unsupported HARNESS_API_STYLE.");

  function authorization() {
    if (style === "dsh-rpc") {
      const username = String(env.HARNESS_USERNAME || "").trim();
      const password = String(env.HARNESS_PASSWORD || "");
      return username && password ? `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` : "";
    }
    const key = String(
      env.HARNESS_API_KEY
      || env.VOLCENGINE_AGENT_PLAN_API_KEY
      || env.ARK_AGENT_PLAN_API_KEY
      || env.ARK_API_KEY
      || "",
    ).trim();
    return key ? `Bearer ${key}` : "";
  }

  async function request(path, body, requestId, maximumMs = timeoutMs(env.HARNESS_TIMEOUT)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, maximumMs));
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const auth = authorization();
    if (auth) headers.Authorization = auth;
    try {
      const response = await fetchImpl(baseUrl + path, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      const text = await response.text().catch(() => "");
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { /* sanitized below */ }
      if (!response.ok) throw harnessError("HARNESS_UPSTREAM", { status: response.status, retryable: response.status >= 500 || response.status === 429 });
      return payload;
    } catch (error) {
      if (error?.name === "HarnessError") throw error;
      const timedOut = error?.name === "AbortError";
      logger.error(JSON.stringify({ event: "research_harness_error", request_id: requestId, error_type: timedOut ? "timeout" : "unreachable" }));
      throw harnessError(timedOut ? "HARNESS_TIMEOUT" : "HARNESS_UNREACHABLE", { retryable: true });
    } finally { clearTimeout(timer); }
  }

  async function rpc(method, payload, requestId, maximumMs) {
    const envelope = await request(`/api/${encodeURIComponent(method)}`, {
      type: "client-request", rpcId: randomUUID(), method, payload,
    }, requestId, maximumMs);
    if (envelope?.type !== "server-response" || !envelope?.result) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
    if (!envelope.result.ok) throw dshFailure(envelope.result.error);
    return envelope.result.value;
  }

  async function ensureDshModel(sessionId, requestId, maximumMs) {
    const model = String(env.HARNESS_MODEL || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!model || selectedDshSessions.has(normalizedSessionId)) return;
    const payload = {
      sessionId: normalizedSessionId,
      provider: String(env.HARNESS_MODEL_PROVIDER || "newapi").trim() || "newapi",
      model,
    };
    const reasoningEffort = String(env.HARNESS_REASONING_EFFORT || "").trim();
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
    await rpc("session.selectModel", payload, requestId, maximumMs);
    selectedDshSessions.add(normalizedSessionId);
  }

  async function ensureDshPreset(sessionId, requestId, maximumMs) {
    const preset = String(env.HARNESS_AGENT_PRESET || "survey-research").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!preset || selectedDshPresets.has(normalizedSessionId)) return;
    const listed = await rpc("session.list", {}, requestId, maximumMs);
    const items = Array.isArray(listed?.items) ? listed.items : Array.isArray(listed) ? listed : [];
    const session = items.find((item) => String(item?.sessionId || item?.id || "") === normalizedSessionId);
    if (!session) throw harnessError("HARNESS_UPSTREAM", { status: 410, retryable: true });
    if (String(session.agentPreset || session.preset || "").trim() === preset) {
      selectedDshPresets.add(normalizedSessionId);
      return;
    }
    await rpc("agentPreset.select", { sessionId: normalizedSessionId, agentPreset: preset }, requestId, maximumMs);
    selectedDshPresets.add(normalizedSessionId);
  }

  async function cancelDshSession(sessionId, requestId) {
    try {
      return await rpc("session.cancel", { sessionId: String(sessionId) }, requestId, CANCEL_TIMEOUT_MS);
    } catch (error) {
      logger.error(JSON.stringify({ event: "research_harness_cancel_error", request_id: requestId, error_type: String(error?.code || "unknown") }));
      return null;
    }
  }

  async function dshSessionState(sessionId, requestId, maximumMs) {
    const listed = await rpc("session.list", {}, requestId, maximumMs);
    const items = Array.isArray(listed?.items) ? listed.items : Array.isArray(listed) ? listed : [];
    const session = items.find((item) => String(item?.sessionId || item?.id || "") === String(sessionId));
    if (!session) throw harnessError("HARNESS_UPSTREAM", { status: 410, retryable: true });
    return { running: Boolean(session.running), updatedAt: Number(session.updatedAt || 0) };
  }

  async function waitForDshTurnEnd(sessionId, baseline, requestId, deadline) {
    const interval = pollIntervalMs(env.HARNESS_POLL_INTERVAL);
    while (Date.now() < deadline) {
      const latest = await rpc("session.history", { sessionId: String(sessionId), maxMessages: 1 }, requestId, Math.max(1, deadline - Date.now()));
      const events = (Array.isArray(latest?.events) ? latest.events : []).filter((entry) => Number(entry?.event?.seq ?? -1) > baseline);
      if (events.some((entry) => entry?.event?.type === "turn/end")) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(1, deadline - Date.now()))));
    }
    throw harnessError("HARNESS_TIMEOUT", { retryable: true });
  }

  async function runDshTurn({ sessionId, prompt, requestId, deadline, options, toolState }) {
    const initialState = await dshSessionState(sessionId, requestId, Math.max(1, deadline - Date.now()));
    const before = await rpc("session.history", { sessionId: String(sessionId), maxMessages: 1 }, requestId, Math.max(1, deadline - Date.now()));
    const baseline = Math.max(-1, ...(Array.isArray(before?.events) ? before.events : []).map((entry) => Number(entry?.event?.seq ?? -1)));
    const promptPayload = {
      sessionId: String(sessionId), mode: "queue", content: [{ type: "text", text: String(prompt || "") }],
      clientTimeZone: String(env.HARNESS_CLIENT_TIME_ZONE || "Asia/Shanghai"),
    };
    await rpc("session.prompt", promptPayload, requestId, Math.max(1, deadline - Date.now()));
    const interval = pollIntervalMs(env.HARNESS_POLL_INTERVAL);
    let observedRunning = false;
    let lastHistoryAt = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(1, deadline - Date.now()))));
      const state = await dshSessionState(sessionId, requestId, Math.max(1, deadline - Date.now()));
      observedRunning ||= state.running;
      const completed = !state.running && (observedRunning || state.updatedAt > initialState.updatedAt);
      const shouldInspectHistory = completed || Date.now() - lastHistoryAt >= HISTORY_POLL_MIN_MS;
      if (!shouldInspectHistory) continue;
      lastHistoryAt = Date.now();
      const latest = await rpc("session.history", { sessionId: String(sessionId), maxMessages: 2 }, requestId, Math.max(1, deadline - Date.now()));
      const events = (Array.isArray(latest?.events) ? latest.events : []).filter((entry) => Number(entry?.event?.seq ?? -1) > baseline);
      const turnEnd = events.filter((entry) => entry?.event?.type === "turn/end").at(-1);
      let blocked = false; let limitExceeded = false;
      for (const entry of events) {
        const observed = observeToolEvent(entry?.event, options, toolState);
        blocked ||= observed.blocked; limitExceeded ||= observed.limitExceeded;
      }
      if (blocked || limitExceeded) {
        if (!turnEnd) {
          await cancelDshSession(sessionId, requestId);
          const baseline = Math.max(-1, ...events.map((entry) => Number(entry?.event?.seq ?? -1)));
          await waitForDshTurnEnd(sessionId, baseline, requestId, deadline);
        }
        return { toolBlocked: blocked, toolLimitExceeded: limitExceeded };
      }
      if (!turnEnd) {
        const interactive = interactiveToolCall(events);
        const reply = interactive ? extractDshReply(events) : "";
        if (!reply) continue;
        const cancellation = await cancelDshSession(sessionId, requestId);
        if (cancellation?.accepted) return { reply };
        continue;
      }
      const reason = turnEnd.event.data?.reason;
      if (reason?.kind === "error") throw dshFailure(reason.error);
      completeObservedTools(options, toolState);
      const reply = extractDshReply(events);
      if (!reply) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
      return { reply, maxTokens: isMaxTokensReason(reason) };
    }
    throw harnessError("HARNESS_TIMEOUT", { retryable: true });
  }

  async function createDshSession({ title, requestId }) {
    const createPayload = {};
    const cwd = String(env.HARNESS_CWD || "").trim();
    if (cwd) createPayload.cwd = cwd;
    const created = await rpc("session.create", createPayload, requestId);
    const sessionId = String(created?.sessionId || "").trim();
    if (!sessionId) throw harnessError("HARNESS_BAD_RESPONSE");
    const preset = String(env.HARNESS_AGENT_PRESET || "survey-research").trim();
    if (preset) await rpc("agentPreset.select", { sessionId, agentPreset: preset }, requestId);
    selectedDshPresets.add(sessionId);
    await ensureDshModel(sessionId, requestId);
    const normalizedTitle = String(title || "SurveyKit research project").trim().slice(0, 300);
    if (normalizedTitle) await rpc("session.rename", { sessionId, title: normalizedTitle }, requestId);
    return sessionId;
  }

  async function sendDshMessage(options) {
    const { sessionId, prompt, requestId, maximumMs, forbidTools = false } = options;
    const maximum = timeoutMs(maximumMs ?? env.HARNESS_TIMEOUT);
    const deadline = Date.now() + maximum;
    const toolState = { calls: new Map(), completed: new Set(), maximum: toolCallLimit(options.maxToolCalls ?? env.HARNESS_MAX_TOOL_CALLS) };
    try {
      await ensureDshPreset(sessionId, requestId, Math.max(1, deadline - Date.now()));
      await ensureDshModel(sessionId, requestId, Math.max(1, deadline - Date.now()));
      const maximumContinuations = continuationLimit(env.HARNESS_MAX_CONTINUATIONS);
      const segments = [];
      let continuationRounds = 0;
      let retriedToolCall = false;
      let nextPrompt = prompt;
      while (Date.now() < deadline) {
        const result = await runDshTurn({ sessionId, prompt: nextPrompt, requestId, deadline, options: { ...options, forbidTools }, toolState });
        if (result.toolLimitExceeded) throw harnessError("HARNESS_TOOL_LIMIT", { retryable: false });
        if (result.toolBlocked && options.researchTools) throw harnessError("HARNESS_TOOL_BLOCKED", { retryable: false });
        if (result.toolBlocked) {
          if (retriedToolCall || continuationRounds > 0) throw harnessError("HARNESS_TOOL_BLOCKED", { retryable: true });
          retriedToolCall = true;
          nextPrompt = DIRECT_REPLY_RETRY_PROMPT;
          continue;
        }
        segments.push(result.reply);
        if (!result.maxTokens) return segments.join("").slice(0, MAX_REPLY_CHARS);
        if (continuationRounds >= maximumContinuations) throw harnessError("HARNESS_MAX_TOKENS", { retryable: true });
        continuationRounds += 1;
        nextPrompt = CONTINUATION_PROMPT;
      }
      throw harnessError("HARNESS_TIMEOUT", { retryable: true });
    } catch (error) {
      completeObservedTools(options, toolState, "error");
      if (error?.code === "HARNESS_TIMEOUT") await cancelDshSession(sessionId, requestId);
      throw error;
    }
  }

  async function sendOpenAiChat(options) {
    const { prompt, requestId, sessionId } = options;
    const maximum = timeoutMs(options.timeoutMs ?? env.HARNESS_TIMEOUT);
    const deadline = Date.now() + maximum;
    const model = String(env.HARNESS_MODEL || "glm-5.3-flash").trim();
    if (!model) throw harnessError("HARNESS_NOT_CONFIGURED");
    const messages = [{ role: "user", content: String(prompt || "") }];
    const segments = [];
    let continuationRounds = 0;
    let toolCalls = 0;
    const toolCounts = new Map();
    const maximumToolCalls = toolCallLimit(options.maxToolCalls ?? env.HARNESS_MAX_TOOL_CALLS);
    const toolBudget = (name) => {
      const configured = Number(options.toolBudgets?.[name]);
      return Number.isFinite(configured) ? Math.max(0, Math.round(configured)) : maximumToolCalls;
    };
    const configuredMaxTokens = Number(env.HARNESS_MAX_OUTPUT_TOKENS);

    while (Date.now() < deadline) {
      const body = { model, messages, stream: false };
      if (promptExpectsJson(prompt)) body.response_format = { type: "json_object" };
      if (Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0) {
        body.max_tokens = Math.min(131_072, Math.max(256, Math.round(configuredMaxTokens)));
      }
      const reasoningEffort = String(env.HARNESS_REASONING_EFFORT || "").trim();
      if (reasoningEffort) body.reasoning_effort = reasoningEffort;
      if (options.researchTools && !options.forbidTools) {
        const allowed = Array.isArray(options.allowedResearchTools)
          ? new Set(options.allowedResearchTools.map(String))
          : RESEARCH_TOOL_NAMES;
        body.tools = Object.entries(OPENAI_RESEARCH_TOOL_DEFINITIONS)
          .filter(([name]) => allowed.has(name) && toolCalls < maximumToolCalls && (toolCounts.get(name) || 0) < toolBudget(name))
          .map(([name, definition]) => ({
            type: "function",
            function: {
              name,
              description: definition.description,
              parameters: {
                type: "object",
                properties: definition.properties,
                ...(definition.required ? { required: definition.required } : {}),
                additionalProperties: false,
              },
            },
          }));
        if (body.tools.length) body.tool_choice = "auto";
      }
      const chatPath = /\/chat\/completions\/?$/i.test(baseUrl) ? "" : "/chat/completions";
      const payload = await request(chatPath, body, requestId, Math.max(1, deadline - Date.now()));
      const responseMessage = payload?.choices?.[0]?.message || {};
      const requestedTools = Array.isArray(responseMessage.tool_calls) ? responseMessage.tool_calls : [];
      if (requestedTools.length) {
        if (!options.researchTools || options.forbidTools || typeof executeTool !== "function") {
          throw harnessError("HARNESS_TOOL_BLOCKED", { retryable: false });
        }
        messages.push({
          role: "assistant",
          content: typeof responseMessage.content === "string" ? responseMessage.content : null,
          tool_calls: requestedTools,
        });
        for (const call of requestedTools) {
          const name = String(call?.function?.name || "");
          const callId = String(call?.id || randomUUID());
          const allowed = !Array.isArray(options.allowedResearchTools) || options.allowedResearchTools.includes(name);
          if (!RESEARCH_TOOL_NAMES.has(name) || !allowed) throw harnessError("HARNESS_TOOL_BLOCKED", { retryable: false });
          if (toolCalls >= maximumToolCalls || (toolCounts.get(name) || 0) >= toolBudget(name)) {
            messages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify({
                success: false,
                error: {
                  code: "TOOL_BUDGET_EXHAUSTED",
                  message: name === "transcript_search"
                    ? "访谈检索预算已用完。请停止继续搜索，改用已有候选 Segment 调用 transcript_read；完成必要回查后直接输出成果。"
                    : "本轮专业工具预算已用完。请使用已经返回的证据直接完成回答，不要继续调用工具。",
                },
              }),
            });
            continue;
          }
          toolCalls += 1;
          toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
          let args;
          try { args = JSON.parse(String(call?.function?.arguments || "{}")); } catch { args = {}; }
          options.onToolStatus?.({ tool_id: name, label: RESEARCH_TOOL_LABELS[name], status: "running", message: RESEARCH_TOOL_RUNNING[name] || "正在调用专业工具…" });
          try {
            const result = await executeTool({ name, args, sessionId, callId, requestId });
            messages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify(result ?? {}) });
            options.onToolStatus?.({ tool_id: name, label: RESEARCH_TOOL_LABELS[name], status: "completed", message: `已完成${RESEARCH_TOOL_LABELS[name]}` });
          } catch (error) {
            options.onToolStatus?.({ tool_id: name, label: RESEARCH_TOOL_LABELS[name], status: "error", message: "专业工具调用未完成" });
            const status = Number(error?.status || 0);
            if ((status >= 400 && status < 500) || String(error?.code || "").endsWith("_REQUIRED") || String(error?.code || "").includes("INVALID")) {
              messages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ success: false, error: { code: String(error?.code || "TOOL_INPUT_INVALID"), message: String(error?.message || "工具参数无效，请修正参数后重试。") } }) });
              continue;
            }
            throw error;
          }
        }
        continue;
      }
      const reply = extractOpenAiReply(payload);
      if (!reply) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
      segments.push(reply);
      if (!openAiReachedTokenLimit(payload)) return segments.join("").slice(0, MAX_REPLY_CHARS);
      if (continuationRounds >= continuationLimit(env.HARNESS_MAX_CONTINUATIONS)) {
        throw harnessError("HARNESS_MAX_TOKENS", { retryable: true });
      }
      continuationRounds += 1;
      messages.push({ role: "assistant", content: reply }, { role: "user", content: CONTINUATION_PROMPT });
    }
    throw harnessError("HARNESS_TIMEOUT", { retryable: true });
  }

  async function createSession({ title, requestId }) {
    if (!baseUrl) throw harnessError("HARNESS_NOT_CONFIGURED");
    if (style === "dsh-rpc") return createDshSession({ title, requestId });
    if (style === "openai-chat") return `openai-chat-${randomUUID()}`;
    const id = extractSessionId(await request("/session", { title: String(title || "SurveyKit research project") }, requestId));
    if (!id) throw harnessError("HARNESS_BAD_RESPONSE");
    return id;
  }

  async function sendMessage(options) {
    const { sessionId, prompt, requestId } = options;
    if (style === "dsh-rpc") return sendDshMessage(options);
    if (style === "openai-chat") return sendOpenAiChat(options);
    const body = { parts: [{ type: "text", text: String(prompt || "") }] };
    const tools = promptTools(options);
    if (tools) body.tools = tools;
    const payload = await request(`/session/${encodeURIComponent(String(sessionId))}/message`, body, requestId);
    const reply = extractReply(payload);
    if (!reply) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
    return reply;
  }

  return {
    isConfigured: () => Boolean(baseUrl
      && (style !== "dsh-rpc" || (String(env.HARNESS_USERNAME || "").trim() && String(env.HARNESS_PASSWORD || "")))
      && (style !== "openai-chat" || (authorization() && String(env.HARNESS_MODEL || "glm-5.3-flash").trim()))),
    createSession,
    sendMessage,
  };
}

module.exports = { createHarnessAdapter, harnessError, extractReply, extractOpenAiReply, extractDshReply, interactiveToolCall };
