import assert from "node:assert/strict";
import fs from "node:fs";
import { extractDshReply } from "../lib/harness.js";
import { createHarnessClient } from "../functions/api/research/[[path]].js";

const productionConfig = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
assert.match(productionConfig, /HARNESS_TIMEOUT\s*=\s*"300000"/, "multi-tool AI requests must have enough time to produce a final answer after tool execution");
assert.match(productionConfig, /HARNESS_LONG_TASK_TIMEOUT\s*=\s*"300000"/, "structured deliverables must allow 300 seconds");
assert.match(productionConfig, /HARNESS_MAX_TOOL_CALLS\s*=\s*"5"/, "a bounded turn must allow three sample-size scenarios plus quota design");

assert.equal(extractDshReply([
  { event: { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", text: "增量" } } } },
  { event: { type: "assistant/chunk", data: { chunk: { type: "analysis-delta", text: "分析" } } } },
  { event: { type: "assistant/chunk", data: { chunk: { text: "正文" } } } },
]), "正文", "reasoning chunks must never be exposed as answer text");

class FakeSocket extends EventTarget {
  accept() {}
  close() { queueMicrotask(() => this.dispatchEvent(new Event("close"))); }
  message(payload) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) })); }
}

const originalFetch = globalThis.fetch;
const calls = [];
let socket = null;
let toolRetry = false;
let toolAttemptCount = 0;
let upstreamError = false;
let promptCount = 0;
let maxTokenMode = null;
let currentPreset = "survey-research";
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  calls.push({ url, init });
  if (url.pathname === "/api/events.mux") { socket = new FakeSocket(); return { status: 101, webSocket: socket }; }
  const body = JSON.parse(init.body);
  const method = body.method;
  let value = {};
  if (method === "session.list") value = { items: [{ sessionId: "session-safe", agentPreset: currentPreset, running: false, updatedAt: Date.now() }] };
  if (method === "agentPreset.select") { currentPreset = body.payload?.agentPreset; value = { agentPreset: currentPreset }; }
  if (method === "session.selectModel") value = { selected: true };
  if (method === "session.prompt") {
    value = { accepted: true };
    promptCount += 1;
    const prompt = body.payload?.content?.[0]?.text || "";
    queueMicrotask(() => {
      if (prompt === "max-once" || prompt === "max-always") {
        maxTokenMode = prompt === "max-once" ? "once" : "always";
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "**Q" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "max-tokens" } } } } });
        return;
      }
      if (prompt.includes("从最后一个字符之后直接续写")) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: maxTokenMode === "always" ? "1" : "50 完整题目" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: maxTokenMode === "always" ? "max-tokens" : "completed" } } } } });
        return;
      }
      if (toolRetry) toolAttemptCount += 1;
      if (toolRetry && toolAttemptCount === 1) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "违规草稿" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "tool/call", data: { name: "write" } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "cancelled" } } } } });
        return;
      }
      if (toolRetry && toolAttemptCount === 2) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "强制正文" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "completed" } } } } });
        return;
      }
      if (upstreamError) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "error", error: { status: 429, code: "quota" } } } } } });
        return;
      }
      socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", text: "第一段" } } } } });
      socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "other-session", event: { type: "assistant/chunk", data: { chunk: { text: "不能泄漏" } } } } });
      socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "第二段" } } } } });
      socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "completed" } } } } });
    });
  }
  return new Response(JSON.stringify({ type: "server-response", result: { ok: true, value } }), { status: 200 });
};

try {
  const client = createHarnessClient({
    HARNESS_BASE_URL: "https://harness.example.test",
    HARNESS_API_STYLE: "dsh-rpc",
    HARNESS_USERNAME: "user",
    HARNESS_PASSWORD: "secret",
    HARNESS_AGENT_PRESET: "surveykit-research",
    HARNESS_MODEL: "deepseek",
    HARNESS_TIMEOUT: "2000",
    HARNESS_MAX_CONTINUATIONS: "1",
  });
  const deltas = [];
  const reply = await client.stream("session-safe", "prompt", "public-request", { onDelta: (text) => deltas.push(text) });
  assert.equal(reply, "第二段");
  assert.deepEqual(deltas, ["第二段"]);
  const presetSelection = calls.find((call) => call.init.body && JSON.parse(call.init.body).method === "agentPreset.select");
  assert.deepEqual(JSON.parse(presetSelection.init.body).payload, { sessionId: "session-safe", agentPreset: "surveykit-research" }, "existing sessions must be upgraded to the configured preset before prompting");
  const mux = calls.find((call) => call.url.pathname === "/api/events.mux");
  assert.equal(mux.url.protocol, "https:");
  assert.equal(mux.init.headers.Upgrade, "websocket");
  assert.equal(mux.init.headers.Authorization, `Basic ${Buffer.from("user:secret").toString("base64")}`);
  assert.ok(!JSON.stringify(deltas).includes("不能泄漏"));
  const continuedDeltas = [];
  const continuedReply = await client.stream("session-safe", "max-once", "continue-request", { onDelta: (text) => continuedDeltas.push(text) });
  assert.equal(continuedReply, "**Q50 完整题目");
  assert.deepEqual(continuedDeltas, ["**Q", "50 完整题目"], "continuation must append without resetting the first segment");
  const maxedDeltas = [];
  await assert.rejects(
    client.stream("session-safe", "max-always", "max-token-request", { onDelta: (text) => maxedDeltas.push(text) }),
    (error) => error?.code === "HARNESS_MAX_TOKENS",
  );
  assert.deepEqual(maxedDeltas, ["**Q", "1"], "exhausted continuation limit must retain all streamed partial content");
  const muxCallsBeforeDirect = calls.filter((call) => call.url.pathname === "/api/events.mux").length;
  toolRetry = true;
  const directDeltas = [];
  let directResets = 0;
  const directReply = await client.stream("session-safe", "research-plan", "direct-request", { forbidTools: true, onDelta: (text) => directDeltas.push(text), onReset: () => { directDeltas.length = 0; directResets += 1; } });
  assert.equal(directReply, "强制正文");
  assert.deepEqual(directDeltas, ["强制正文"]);
  assert.equal(directResets, 1, "tool-blocked attempt must clear its streamed draft before retry");
  assert.equal(calls.filter((call) => call.init.body && JSON.parse(call.init.body).method === "session.cancel").length, 1, "tool call must cancel the first direct-reply attempt");
  assert.equal(calls.filter((call) => call.url.pathname === "/api/events.mux").length - muxCallsBeforeDirect, 2, "direct reply retry must reopen mux before its retry prompt");
  toolRetry = false;
  upstreamError = true;
  await assert.rejects(client.stream("session-safe", "quota", "error-request"), (error) => error?.code === "HARNESS_UPSTREAM" && error?.status === 429);
  console.log("research-streaming-smoke: PASS");
} finally { globalThis.fetch = originalFetch; }
