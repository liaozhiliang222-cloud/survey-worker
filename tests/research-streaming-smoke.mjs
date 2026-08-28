import assert from "node:assert/strict";
import { extractDshReply } from "../lib/harness.js";
import { createHarnessClient } from "../functions/api/research/[[path]].js";

assert.equal(extractDshReply([
  { event: { type: "assistant/chunk", data: { chunk: { type: "reasoning", text: "增量" } } } },
  { event: { type: "assistant/chunk", data: { chunk: { text: "正文" } } } },
]), "增量正文", "chunk.text must be accepted regardless of chunk.type");

class FakeSocket extends EventTarget {
  accept() {}
  close() { queueMicrotask(() => this.dispatchEvent(new Event("close"))); }
  message(payload) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) })); }
}

const originalFetch = globalThis.fetch;
const calls = [];
let socket = null;
let toolRetry = false;
let upstreamError = false;
let promptCount = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  calls.push({ url, init });
  if (url.pathname === "/api/events.mux") { socket = new FakeSocket(); return { status: 101, webSocket: socket }; }
  const body = JSON.parse(init.body);
  const method = body.method;
  let value = {};
  if (method === "session.selectModel") value = { selected: true };
  if (method === "session.prompt") {
    value = { accepted: true };
    promptCount += 1;
    queueMicrotask(() => {
      if (toolRetry && promptCount === 2) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "违规草稿" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "tool/call", data: { name: "write" } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "cancelled" } } } } });
        return;
      }
      if (toolRetry && promptCount === 3) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { text: "强制正文" } } } } });
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "completed" } } } } });
        return;
      }
      if (upstreamError) {
        socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "turn/end", data: { reason: { kind: "error", error: { status: 429, code: "quota" } } } } } });
        return;
      }
      socket.message({ type: "server-request", payload: { type: "session/event", sessionId: "session-safe", event: { type: "assistant/chunk", data: { chunk: { type: "reasoning", text: "第一段" } } } } });
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
    HARNESS_MODEL: "deepseek",
    HARNESS_TIMEOUT: "2000",
  });
  const deltas = [];
  const reply = await client.stream("session-safe", "prompt", "public-request", { onDelta: (text) => deltas.push(text) });
  assert.equal(reply, "第一段第二段");
  assert.deepEqual(deltas, ["第一段", "第二段"]);
  const mux = calls.find((call) => call.url.pathname === "/api/events.mux");
  assert.equal(mux.url.protocol, "https:");
  assert.equal(mux.init.headers.Upgrade, "websocket");
  assert.equal(mux.init.headers.Authorization, `Basic ${Buffer.from("user:secret").toString("base64")}`);
  assert.ok(!JSON.stringify(deltas).includes("不能泄漏"));
  toolRetry = true;
  const directDeltas = [];
  let directResets = 0;
  const directReply = await client.stream("session-safe", "research-plan", "direct-request", { forbidTools: true, onDelta: (text) => directDeltas.push(text), onReset: () => { directDeltas.length = 0; directResets += 1; } });
  assert.equal(directReply, "强制正文");
  assert.deepEqual(directDeltas, ["强制正文"]);
  assert.equal(directResets, 1, "tool-blocked attempt must clear its streamed draft before retry");
  assert.equal(calls.filter((call) => call.init.body && JSON.parse(call.init.body).method === "session.cancel").length, 1, "tool call must cancel the first direct-reply attempt");
  assert.equal(calls.filter((call) => call.url.pathname === "/api/events.mux").length, 3, "direct reply retry must reopen mux before its retry prompt");
  toolRetry = false;
  upstreamError = true;
  await assert.rejects(client.stream("session-safe", "quota", "error-request"), (error) => error?.code === "HARNESS_UPSTREAM" && error?.status === 429);
  console.log("research-streaming-smoke: PASS");
} finally { globalThis.fetch = originalFetch; }
