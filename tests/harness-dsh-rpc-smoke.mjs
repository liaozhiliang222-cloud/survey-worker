import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createHarnessAdapter } = require("../lib/harness.js");
const calls = [];
const sessions = new Map();
let nextSession = 0;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function response(res, rpcId, value, error = null) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ type: "server-response", rpcId, result: error ? { ok: false, error } : { ok: true, value } }));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => raw += chunk);
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    calls.push({ url: req.url, auth: req.headers.authorization, body });
    const payload = body.payload || {};
    if (req.url === "/api/session.create") {
      const sessionId = `dsh-session-${++nextSession}`;
      sessions.set(sessionId, { sessionId, events: [], preset: "standard", title: "", model: null, running: false, updatedAt: Date.now() });
      response(res, body.rpcId, { sessionId, agentPreset: "standard" }); return;
    }
    if (req.url === "/api/session.list") {
      response(res, body.rpcId, { items: [...sessions.values()].map(({ sessionId, running, updatedAt }) => ({ sessionId, running, updatedAt })) }); return;
    }
    const session = sessions.get(payload.sessionId);
    if (!session) { response(res, body.rpcId, null, { code: "session-not-found", message: "missing", details: {} }); return; }
    if (req.url === "/api/agentPreset.select") { session.preset = payload.agentPreset; response(res, body.rpcId, { agentPreset: payload.agentPreset }); return; }
    if (req.url === "/api/session.selectModel") { session.model = { provider: payload.provider, model: payload.model, reasoningEffort: payload.reasoningEffort }; response(res, body.rpcId, { selected: session.model }); return; }
    if (req.url === "/api/session.rename") { session.title = payload.title; response(res, body.rpcId, { title: payload.title, seq: 0 }); return; }
    if (req.url === "/api/session.history") { const events = payload.maxMessages === 1 ? session.events.slice(session.turnStart || 0) : session.events; response(res, body.rpcId, { events, hasMore: false, projections: {} }); return; }
    if (req.url === "/api/session.cancel") {
      session.cancelled = true;
      session.running = false;
      session.updatedAt += 1;
      if (session.events.at(-1)?.event?.type !== "turn/end") session.events.push({ event: { type: "turn/end", seq: session.events.length, data: { reason: { kind: "cancelled" } } } });
      response(res, body.rpcId, { accepted: true }); return;
    }
    if (req.url === "/api/session.prompt") {
      const start = session.events.length;
      const prompt = payload.content?.[0]?.text || "";
      session.turnStart = start;
      session.running = true;
      session.updatedAt += 1;
      session.events.push({ event: { type: "user/message", seq: start, data: { content: payload.content } } });
      if (prompt === "quota") {
        session.events.push({ event: { type: "turn/end", seq: start + 1, data: { reason: { kind: "error", error: { code: "QUOTA", status: 429, message: "insufficient balance" } } } } });
      } else if (prompt === "tool-attempt") {
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: "准备调用工具。" }] } } } },
          { event: { type: "tool/call", seq: start + 2, data: { name: "bash", arguments: "{}" } } },
        );
      } else if (prompt.includes("强制正文直出重试")) {
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: "正文直出成功" }] } } } },
          { event: { type: "turn/end", seq: start + 2, data: { reason: { kind: "completed" } } } },
        );
      } else if (prompt === "max-once" || prompt === "max-always") {
        session.continuationMode = prompt === "max-once" ? "once" : "always";
        session.continuationCount = 0;
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: "**Q" }] } } } },
          { event: { type: "turn/end", seq: start + 2, data: { reason: { kind: "max-tokens" } } } },
        );
      } else if (prompt.includes("从最后一个字符之后直接续写")) {
        session.continuationCount += 1;
        const maxed = session.continuationMode === "always";
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: maxed ? String(session.continuationCount) : "50 完整题目" }] } } } },
          { event: { type: "turn/end", seq: start + 2, data: { reason: { kind: maxed ? "max-tokens" : "completed" } } } },
        );
      } else if (prompt === "hang") {
        // Intentionally leave the turn running so timeout cancellation can be verified.
      } else if (prompt === "clarify") {
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: "请补充目标人群。" }] } } } },
          { event: { type: "tool/call", seq: start + 2, data: { name: "ask_user_question", arguments: "{}" } } },
        );
      } else {
        session.events.push(
          { event: { type: "assistant/message", seq: start + 1, data: { message: { content: [{ type: "text", text: "DSH connected" }] } } } },
          { event: { type: "turn/end", seq: start + 2, data: { reason: { kind: "completed" } } } },
        );
      }
      if (!["tool-attempt", "hang", "clarify"].includes(prompt)) session.running = false;
      session.updatedAt += 1;
      response(res, body.rpcId, { accepted: true }); return;
    }
    res.writeHead(404).end();
  });
});

const port = await listen(server);
try {
  const adapter = createHarnessAdapter({ env: {
    HARNESS_BASE_URL: `http://127.0.0.1:${port}`,
    HARNESS_API_STYLE: "dsh-rpc",
    HARNESS_USERNAME: "admin",
    HARNESS_PASSWORD: "secret",
    HARNESS_AGENT_PRESET: "survey-research",
    HARNESS_MODEL_PROVIDER: "newapi",
    HARNESS_MODEL: "deepseek-v4-flash",
    HARNESS_TIMEOUT: "2000",
    HARNESS_POLL_INTERVAL: "100",
    HARNESS_MAX_CONTINUATIONS: "1",
  } });
  const sessionId = await adapter.createSession({ title: "SurveyKit project", requestId: "dsh-create" });
  const historyCallsBeforePing = calls.filter((call) => call.url === "/api/session.history").length;
  const reply = await adapter.sendMessage({ sessionId, prompt: "ping", requestId: "dsh-prompt" });
  assert.equal(reply, "DSH connected");
  assert.equal(calls.filter((call) => call.url === "/api/session.history").length - historyCallsBeforePing, 1, "completed turns should pull history once");
  assert.equal(sessions.get(sessionId).preset, "survey-research");
  assert.deepEqual(sessions.get(sessionId).model, { provider: "newapi", model: "deepseek-v4-flash", reasoningEffort: undefined });
  assert.equal(sessions.get(sessionId).title, "SurveyKit project");
  assert.ok(calls.every((call) => call.auth === `Basic ${Buffer.from("admin:secret").toString("base64")}`));
  assert.deepEqual(calls.find((call) => call.url === "/api/session.prompt").body.payload.content, [{ type: "text", text: "ping" }]);
  const clarification = await adapter.sendMessage({ sessionId, prompt: "clarify", requestId: "dsh-clarify" });
  assert.equal(clarification, "请补充目标人群。");
  assert.equal(sessions.get(sessionId).cancelled, true);
  assert.ok(calls.some((call) => call.url === "/api/session.cancel"));
  const activeSession = sessions.get(sessionId);
  activeSession.cancelled = false;
  const directReply = await adapter.sendMessage({ sessionId, prompt: "tool-attempt", requestId: "dsh-direct", forbidTools: true, timeoutMs: 2_000 });
  assert.equal(directReply, "正文直出成功");
  assert.equal(activeSession.cancelled, true);
  const directPrompts = calls.filter((call) => call.url === "/api/session.prompt").map((call) => call.body.payload.content?.[0]?.text || "");
  assert.equal(directPrompts.filter((text) => text === "tool-attempt" || text.includes("强制正文直出重试")).length, 2);
  activeSession.cancelled = false;
  await assert.rejects(
    adapter.sendMessage({ sessionId, prompt: "hang", requestId: "dsh-timeout", timeoutMs: 450 }),
    (error) => error.code === "HARNESS_TIMEOUT" && error.retryable,
  );
  assert.equal(activeSession.cancelled, true, "timeout must cancel the remote Harness turn");
  assert.equal(await adapter.sendMessage({ sessionId, prompt: "max-once", requestId: "dsh-continue" }), "**Q50 完整题目");
  const continuationPrompts = calls.filter((call) => call.url === "/api/session.prompt").map((call) => call.body.payload.content?.[0]?.text || "");
  assert.equal(continuationPrompts.filter((text) => text.includes("从最后一个字符之后直接续写")).length, 1, "max-tokens must trigger one continuation prompt");
  await assert.rejects(
    adapter.sendMessage({ sessionId, prompt: "max-always", requestId: "dsh-max-tokens" }),
    (error) => error.code === "HARNESS_MAX_TOKENS" && error.retryable,
  );
  await assert.rejects(
    adapter.sendMessage({ sessionId, prompt: "quota", requestId: "dsh-quota" }),
    (error) => error.code === "HARNESS_UPSTREAM" && error.status === 429 && error.retryable,
  );
  assert.ok(calls.filter((call) => call.url === "/api/session.history").every((call) => call.body.payload.maxMessages === 1));
  console.log("harness-dsh-rpc-smoke: PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
