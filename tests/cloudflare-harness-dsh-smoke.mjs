import assert from "node:assert/strict";
import { createHarnessClient } from "../functions/api/research/[[path]].js";

const originalFetch = globalThis.fetch;
const calls = [];
const sessions = new Map();
let counter = 0;

globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  const body = JSON.parse(init.body);
  calls.push({ path: url.pathname, auth: init.headers.Authorization, body });
  const payload = body.payload || {};
  let value;
  let error;
  if (url.pathname === "/api/session.create") {
    const sessionId = `edge-session-${++counter}`;
    sessions.set(sessionId, { sessionId, events: [], preset: "", title: "", model: null, running: false, updatedAt: Date.now() }); value = { sessionId, agentPreset: "standard" };
  } else if (url.pathname === "/api/session.list") {
    value = { items: [...sessions.values()].map(({ sessionId, preset, running, updatedAt }) => ({ sessionId, agentPreset: preset, running, updatedAt })) };
  } else {
    const session = sessions.get(payload.sessionId);
    if (!session) error = { code: "session-not-found", message: "missing", details: {} };
    else if (url.pathname === "/api/agentPreset.select") { if(session.presetLocked)error={code:"agent-preset-locked",message:"preset fixed",details:{}};else{session.preset = payload.agentPreset; value = { agentPreset: payload.agentPreset };} }
    else if (url.pathname === "/api/session.selectModel") { session.model = { provider: payload.provider, model: payload.model, reasoningEffort: payload.reasoningEffort }; value = { selected: session.model }; }
    else if (url.pathname === "/api/session.rename") { session.title = payload.title; value = { title: payload.title, seq: 0 }; }
    else if (url.pathname === "/api/session.history") value = { events: payload.maxMessages === 1 ? session.events.slice(session.turnStart || 0) : session.events, hasMore: false, projections: {} };
    else if (url.pathname === "/api/session.cancel") {
      session.cancelled = true;
      session.running = false;
      session.updatedAt += 1;
      if (session.events.at(-1)?.event?.type !== "turn/end") session.events.push({ event: { type: "turn/end", seq: session.events.length, data: { reason: { kind: "cancelled" } } } });
      value = { accepted: true };
    }
    else if (url.pathname === "/api/session.prompt") {
      const seq = session.events.length;
      const prompt = payload.content?.[0]?.text || "";
      session.turnStart = seq;
      session.running = true;
      session.updatedAt += 1;
      if (prompt === "tool-attempt") {
        session.events.push(
          { event: { type: "assistant/message", seq, data: { message: { content: [{ type: "text", text: "准备调用工具。" }] } } } },
          { event: { type: "tool/call", seq: seq + 1, data: { name: "write", arguments: "{}" } } },
        );
      } else if (prompt === "research-quota") {
        session.events.push(
          { event: { type: "tool/call", seq, data: { name: "quota_design", callId: "quota-call", arguments: "{}" } } },
          { event: { type: "assistant/message", seq: seq + 1, data: { message: { content: [{ type: "text", text: "配额已按 1200 样本生成。" }] } } } },
          { event: { type: "turn/end", seq: seq + 2, data: { reason: { kind: "completed" } } } },
        );
      } else if (prompt === "max-once" || prompt === "max-always") {
        session.continuationMode = prompt === "max-once" ? "once" : "always";
        session.continuationCount = 0;
        session.events.push(
          { event: { type: "assistant/message", seq, data: { message: { content: [{ type: "text", text: "**Q" }] } } } },
          { event: { type: "turn/end", seq: seq + 1, data: { reason: { kind: "max-tokens" } } } },
        );
      } else if (prompt.includes("从最后一个字符之后直接续写")) {
        session.continuationCount += 1;
        const maxed = session.continuationMode === "always";
        session.events.push(
          { event: { type: "assistant/message", seq, data: { message: { content: [{ type: "text", text: maxed ? String(session.continuationCount) : "50 edge" }] } } } },
          { event: { type: "turn/end", seq: seq + 1, data: { reason: { kind: maxed ? "max-tokens" : "completed" } } } },
        );
      } else {
        session.events.push(
          { event: { type: "assistant/message", seq, data: { message: { content: [{ type: "text", text: prompt.includes("强制正文直出重试") ? "edge direct" : "edge connected" }] } } } },
          { event: { type: "turn/end", seq: seq + 1, data: { reason: { kind: "completed" } } } },
        );
      }
      if (prompt !== "tool-attempt") session.running = false;
      session.updatedAt += 1;
      value = { accepted: true };
    }
  }
  return new Response(JSON.stringify({ type: "server-response", rpcId: body.rpcId, result: error ? { ok: false, error } : { ok: true, value } }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

try {
  const client = createHarnessClient({
    HARNESS_BASE_URL: "https://agent.example.test",
    HARNESS_API_STYLE: "dsh-rpc",
    HARNESS_USERNAME: "admin",
    HARNESS_PASSWORD: "secret",
    HARNESS_AGENT_PRESET: "surveykit-research",
    HARNESS_MODEL_PROVIDER: "newapi",
    HARNESS_MODEL: "deepseek-v4-flash",
    HARNESS_POLL_INTERVAL: "100",
    HARNESS_TIMEOUT: "2000",
    HARNESS_MAX_CONTINUATIONS: "1",
  });
  const sessionId = await client.create("Edge SurveyKit", "edge-create");
  const historyCallsBeforePing = calls.filter((call) => call.path === "/api/session.history").length;
  assert.equal(await client.send(sessionId, "ping", "edge-send"), "edge connected");
  assert.equal(calls.filter((call) => call.path === "/api/session.history").length - historyCallsBeforePing, 2, "completed turns should snapshot the baseline and inspect the bounded result window");
  assert.equal(await client.send(sessionId, "tool-attempt", "edge-direct", { forbidTools: true, timeoutMs: 2_000 }), "edge direct");
  const statuses = [];
  assert.match(await client.send(sessionId, "research-quota", "edge-tool", { researchTools: true, onToolStatus: (status) => statuses.push(status) }), /1200/);
  assert.deepEqual(statuses.map((status) => status.status), ["running", "completed"]);
  const researchPrompt = calls.filter((call) => call.path === "/api/session.prompt").find((call) => call.body.payload.content?.[0]?.text === "research-quota");
  assert.equal(Object.hasOwn(researchPrompt.body.payload, "tools"), false, "DSH session.prompt must contain only supported fields");
  assert.equal(await client.send(sessionId, "max-once", "edge-continue"), "**Q50 edge");
  await assert.rejects(client.send(sessionId, "max-always", "edge-max-tokens"), (error) => error?.code === "HARNESS_MAX_TOKENS");
  assert.equal(sessions.get(sessionId).cancelled, true);
  assert.equal(sessions.get(sessionId).preset, "surveykit-research");
  assert.deepEqual(sessions.get(sessionId).model, { provider: "newapi", model: "deepseek-v4-flash", reasoningEffort: undefined });
  assert.equal(sessions.get(sessionId).title, "Edge SurveyKit");
  sessions.set("legacy-edge-session", { sessionId: "legacy-edge-session", events: [], preset: "survey-research", presetLocked: true, title: "Legacy", model: null, running: false, updatedAt: Date.now() });
  await assert.rejects(client.send("legacy-edge-session", "ping", "legacy-edge-upgrade"), (error) => error.code === "HARNESS_UPSTREAM" && error.status === 410, "locked legacy edge presets must request safe session recreation");
  assert.ok(calls.every((call) => call.auth === `Basic ${Buffer.from("admin:secret").toString("base64")}`));
  const historyWindows = calls.filter((call) => call.path === "/api/session.history").map((call) => call.body.payload.maxMessages);
  assert.ok(historyWindows.every((size) => size === 1 || size === 2));
  assert.ok(historyWindows.includes(2), "completed-turn inspection must include the tool call and result message pair");
  console.log("cloudflare-harness-dsh-smoke: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
