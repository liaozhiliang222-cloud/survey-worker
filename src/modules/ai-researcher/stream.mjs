/** AI Researcher V0.3.1 流式响应工具。SSE 是可选能力；现有 JSON 契约保持兼容。 */
export const RESEARCH_RUN_RECOVERY_TIMEOUT_MS = 210_000;
export function latestStreamSnapshot(events = []) {
  let snapshot = "";
  for (const item of events) {
    const event = String(item?.event || "").toLowerCase();
    const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
    if (typeof payload.partial_content === "string") snapshot = payload.partial_content;
    else if (event === "delta" && typeof payload.text === "string") snapshot += payload.text;
    else if (!event && typeof payload.delta === "string") snapshot += payload.delta;
  }
  return snapshot;
}

export function normalizeStreamPayload(payload = {}) {
  if (typeof payload === "string") return { kind: "delta", text: payload };
  const type = String(payload.type || "").toLowerCase();
  if (payload.error) {
    const error = payload.error;
    return { kind: "error", message: typeof error === "string" ? error : error.message || payload.message || "流式响应出错。", retryable: Boolean(typeof error === "object" ? error.retryable : payload.retryable) };
  }
  if (type === "error") return { kind: "error", message: payload.message || "流式响应出错。", retryable: Boolean(payload.retryable) };
  if (payload.message && typeof payload.message === "object") return { kind: "complete", result: payload };
  if (payload.applied_context || payload.user_message || payload.idempotent_replay !== undefined || type === "done" || type === "complete" || payload.done === true) return { kind: "complete", result: payload };
  if (typeof payload.delta === "string") return { kind: "delta", text: payload.delta };
  if (typeof payload.text === "string") return { kind: "delta", text: payload.text };
  if (typeof payload.reply === "string" && !type) return { kind: "delta", text: payload.reply };
  if (typeof payload.content === "string" && !type) return { kind: "delta", text: payload.content };
  return { kind: "unknown", payload };
}

export function parseSseBuffer(buffer, { flush = false } = {}) {
  const events = [];
  let offset = 0;
  while (offset < buffer.length) {
    let end = buffer.indexOf("\n\n", offset);
    let length = 2;
    const windows = buffer.indexOf("\r\n\r\n", offset);
    if (windows !== -1 && (end === -1 || windows < end)) { end = windows; length = 4; }
    const carriage = buffer.indexOf("\r\r", offset);
    if (carriage !== -1 && (end === -1 || carriage < end)) { end = carriage; length = 2; }
    if (end === -1) {
      if (!flush) break;
      end = buffer.length;
      length = 0;
    }
    const block = buffer.slice(offset, end).replace(/^\uFEFF/, "");
    offset = end + length;
    if (!block.trim() || block.startsWith(":")) continue;
    let event = "message";
    const lines = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (!rawLine || rawLine.startsWith(":")) continue;
      if (rawLine.startsWith("event:")) event = rawLine.slice(6).trim() || "message";
      else if (rawLine.startsWith("data:")) lines.push(rawLine.slice(5).replace(/^ /, ""));
    }
    const data = lines.join("\n");
    if (!data) continue;
    let payload = data;
    try { payload = JSON.parse(data); } catch { /* 明文 data 分片同样可显示 */ }
    events.push({ event, payload });
  }
  return { events, remainder: buffer.slice(offset) };
}

export async function readSseResponse(response, { onDelta, onResult, onProgress } = {}) {
  if (!response.body?.getReader) throw new Error("当前浏览器不支持流式响应读取。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result = null;
  const events = [];
  const consume = (event) => {
    events.push(event);
    const normalized = normalizeStreamPayload(event.payload);
    if (String(event.event || "").toLowerCase() === "progress" && typeof event.payload?.partial_content === "string") onProgress?.(event.payload.partial_content, event);
    else if (normalized.kind === "delta") onDelta?.(normalized.text, event);
    else if (normalized.kind === "complete") { result = normalized.result; onResult?.(normalized.result, event); }
    else if (normalized.kind === "error") { const error = new Error(normalized.message); error.retryable = normalized.retryable; error.runId = event.payload?.run_id || events.find((item) => item.event === "start")?.payload?.run_id || ""; throw error; }
    else if (typeof event.payload === "string") onDelta?.(event.payload, event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parsed = parseSseBuffer(buffered, { flush: done });
      buffered = parsed.remainder;
      parsed.events.forEach(consume);
      if (done) break;
    }
  } catch (error) {
    error.runId ||= events.find((item) => item.event === "start")?.payload?.run_id || "";
    error.partialContent ||= latestStreamSnapshot(events);
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  return { result, partialContent: latestStreamSnapshot(events), events };
}
