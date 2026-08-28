"use strict";

const { randomUUID } = require("crypto");

const DEFAULT_TIMEOUT_MS = 120_000;
const CANCEL_TIMEOUT_MS = 5_000;
const MAX_REPLY_CHARS = 2 * 1024 * 1024;
const SUPPORTED_STYLES = new Set(["opencode", "dsh-rpc"]);
const INTERACTIVE_TOOL_NAMES = new Set(["ask_user_question", "request_user_input"]);
const DIRECT_REPLY_RETRY_PROMPT = "【强制正文直出重试】上一轮因尝试调用工具已被系统取消。不要调用任何工具，不要创建或读取文件，不要解释执行过程；请基于上一条用户要求，立即在本轮回复正文中给出完整成果。";
const HISTORY_POLL_MIN_MS = 10_000;

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

function extractSessionId(payload) {
  return String(payload?.id || payload?.session?.id || payload?.data?.id || "").trim();
}

function extractReply(payload) {
  const parts = payload?.parts || payload?.message?.parts || payload?.data?.parts || payload?.data?.message?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim().slice(0, MAX_REPLY_CHARS);
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
    .filter((chunk) => typeof chunk?.text === "string")
    .map((chunk) => chunk.text).join("").trim().slice(0, MAX_REPLY_CHARS);
}

function interactiveToolCall(events) {
  return events.filter((entry) => entry?.event?.type === "tool/call" && INTERACTIVE_TOOL_NAMES.has(String(entry.event.data?.name || ""))).at(-1) || null;
}

function dshFailure(error) {
  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.status || error?.details?.status || error?.details?.error?.status || 0);
  if (status === 429 || code === "quota" || code.includes("rate-limit")) return harnessError("HARNESS_UPSTREAM", { status: 429, retryable: true });
  if (status === 404 || status === 410 || code.includes("session-not-found") || code.includes("session-removed")) return harnessError("HARNESS_UPSTREAM", { status: 410, retryable: true });
  return harnessError("HARNESS_UPSTREAM", { status: status || 502, retryable: status >= 500 });
}

function createHarnessAdapter({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Harness adapter requires fetch.");
  const baseUrl = String(env.HARNESS_BASE_URL || "").trim().replace(/\/+$/, "");
  const style = String(env.HARNESS_API_STYLE || "opencode").trim().toLowerCase();
  const selectedDshSessions = new Set();
  if (!SUPPORTED_STYLES.has(style)) throw new Error("Unsupported HARNESS_API_STYLE.");

  function authorization() {
    if (style === "dsh-rpc") {
      const username = String(env.HARNESS_USERNAME || "").trim();
      const password = String(env.HARNESS_PASSWORD || "");
      return username && password ? `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` : "";
    }
    const key = String(env.HARNESS_API_KEY || "").trim();
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

  async function runDshTurn({ sessionId, prompt, requestId, deadline, forbidTools }) {
    const initialState = await dshSessionState(sessionId, requestId, Math.max(1, deadline - Date.now()));
    await rpc("session.prompt", {
      sessionId: String(sessionId), mode: "queue", content: [{ type: "text", text: String(prompt || "") }],
      clientTimeZone: String(env.HARNESS_CLIENT_TIME_ZONE || "Asia/Shanghai"),
    }, requestId, Math.max(1, deadline - Date.now()));
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
      const latest = await rpc("session.history", { sessionId: String(sessionId), maxMessages: 1 }, requestId, Math.max(1, deadline - Date.now()));
      const events = Array.isArray(latest?.events) ? latest.events : [];
      const turnEnd = events.filter((entry) => entry?.event?.type === "turn/end").at(-1);
      const toolCall = forbidTools ? events.find((entry) => entry?.event?.type === "tool/call") : null;
      if (toolCall) {
        if (!turnEnd) {
          await cancelDshSession(sessionId, requestId);
          const baseline = Math.max(-1, ...events.map((entry) => Number(entry?.event?.seq ?? -1)));
          await waitForDshTurnEnd(sessionId, baseline, requestId, deadline);
        }
        return { toolBlocked: true };
      }
      if (!turnEnd) {
        const interactive = interactiveToolCall(events);
        const reply = interactive ? extractDshReply(events) : "";
        if (!reply) continue;
        const cancellation = await cancelDshSession(sessionId, requestId);
        if (cancellation?.accepted) return { reply };
        continue;
      }
      if (turnEnd.event.data?.reason?.kind === "error") throw dshFailure(turnEnd.event.data.reason.error);
      const reply = extractDshReply(events);
      if (!reply) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
      return { reply };
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
    await ensureDshModel(sessionId, requestId);
    const normalizedTitle = String(title || "SurveyKit research project").trim().slice(0, 300);
    if (normalizedTitle) await rpc("session.rename", { sessionId, title: normalizedTitle }, requestId);
    return sessionId;
  }

  async function sendDshMessage({ sessionId, prompt, requestId, maximumMs, forbidTools = false }) {
    const maximum = timeoutMs(maximumMs ?? env.HARNESS_TIMEOUT);
    const deadline = Date.now() + maximum;
    try {
      await ensureDshModel(sessionId, requestId, Math.max(1, deadline - Date.now()));
      const attempts = forbidTools ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = await runDshTurn({ sessionId, prompt: attempt === 0 ? prompt : DIRECT_REPLY_RETRY_PROMPT, requestId, deadline, forbidTools });
        if (result.reply) return result.reply;
        if (!result.toolBlocked) break;
      }
      throw harnessError("HARNESS_TOOL_BLOCKED", { retryable: true });
    } catch (error) {
      if (error?.code === "HARNESS_TIMEOUT") await cancelDshSession(sessionId, requestId);
      throw error;
    }
  }

  async function createSession({ title, requestId }) {
    if (!baseUrl) throw harnessError("HARNESS_NOT_CONFIGURED");
    if (style === "dsh-rpc") return createDshSession({ title, requestId });
    const id = extractSessionId(await request("/session", { title: String(title || "SurveyKit research project") }, requestId));
    if (!id) throw harnessError("HARNESS_BAD_RESPONSE");
    return id;
  }

  async function sendMessage({ sessionId, prompt, requestId, timeoutMs: maximumMs, forbidTools = false }) {
    if (style === "dsh-rpc") return sendDshMessage({ sessionId, prompt, requestId, maximumMs, forbidTools });
    const payload = await request(`/session/${encodeURIComponent(String(sessionId))}/message`, { parts: [{ type: "text", text: String(prompt || "") }] }, requestId);
    const reply = extractReply(payload);
    if (!reply) throw harnessError("HARNESS_BAD_RESPONSE", { retryable: true });
    return reply;
  }

  return {
    isConfigured: () => Boolean(baseUrl && (style !== "dsh-rpc" || (String(env.HARNESS_USERNAME || "").trim() && String(env.HARNESS_PASSWORD || "")))),
    createSession,
    sendMessage,
  };
}

module.exports = { createHarnessAdapter, harnessError, extractReply, extractDshReply, interactiveToolCall };
