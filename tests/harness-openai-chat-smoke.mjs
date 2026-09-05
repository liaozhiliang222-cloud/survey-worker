import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { createHarnessClient } from "../functions/api/research/[[path]].js";

const require = createRequire(import.meta.url);
const { createHarnessAdapter } = require("../lib/harness.js");

const calls = [];
const toolExecutions = [];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => raw += chunk);
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    calls.push({ url: req.url, auth: req.headers.authorization, body });
    if (req.url.startsWith("/tools/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, data: { matches: [{ transcript_id: "transcript-1", segment_id: "segment-1" }] } }));
      return;
    }
    const latest = body.messages?.at(-1);
    const first = body.messages?.[0]?.content;
    res.setHeader("Content-Type", "application/json");

    if (first === "quota") {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: { message: "quota" } }));
      return;
    }
    if (["tool", "edge-tool-schema"].includes(first) && latest?.role !== "tool") {
      res.end(JSON.stringify({
        choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "transcript_search", arguments: "{\"query\":\"价保\",\"limit\":3}" } }] } }],
      }));
      return;
    }
    if (first === "budget" && !body.messages?.some((message) => message.role === "tool")) {
      res.end(JSON.stringify({
        choices: [{ finish_reason: "tool_calls", message: {
          role: "assistant",
          content: null,
          tool_calls: [1, 2, 3, 4].map((index) => ({ id: `budget-${index}`, type: "function", function: { name: "transcript_search", arguments: `{"query":"主题${index}"}` } })),
        } }],
      }));
      return;
    }
    if (first === "budget") {
      res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "预算内完成" } }] }));
      return;
    }
    if (latest?.role === "tool") {
      res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "工具结果已验证" } }] }));
      return;
    }
    if (first === "continue" && body.messages.length === 1) {
      res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "上半段" } }] }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: body.messages.length > 1 ? "下半段" : "GLM connected" } }] }));
  });
});

const port = await listen(server);
try {
  const statuses = [];
  const adapter = createHarnessAdapter({
    env: {
      HARNESS_BASE_URL: `http://127.0.0.1:${port}`,
      HARNESS_API_STYLE: "openai-chat",
      VOLCENGINE_AGENT_PLAN_API_KEY: "ark-test-secret",
      HARNESS_MODEL: "glm-5.3-flash",
      HARNESS_TIMEOUT: "2000",
      HARNESS_MAX_CONTINUATIONS: "1",
    },
    executeTool: async (input) => {
      toolExecutions.push(input);
      return { matches: [{ segment_id: "segment-1" }] };
    },
  });

  assert.equal(adapter.isConfigured(), true);
  const sessionId = await adapter.createSession({ title: "真实定性研究", requestId: "create-1" });
  assert.match(sessionId, /^openai-chat-/);
  assert.equal(await adapter.sendMessage({ sessionId, prompt: "ping", requestId: "prompt-1" }), "GLM connected");
  assert.equal(await adapter.sendMessage({ sessionId, prompt: "continue", requestId: "prompt-2" }), "上半段下半段");
  assert.equal(await adapter.sendMessage({
    sessionId,
    prompt: "tool",
    requestId: "prompt-3",
    researchTools: true,
    allowedResearchTools: ["transcript_search", "transcript_read"],
    maxToolCalls: 2,
    onToolStatus: (status) => statuses.push(status),
  }), "工具结果已验证");

  assert.equal(toolExecutions.length, 1);
  assert.deepEqual(toolExecutions[0].args, { query: "价保", limit: 3 });
  assert.deepEqual(statuses.map((item) => [item.tool_id, item.status]), [["transcript_search", "running"], ["transcript_search", "completed"]]);
  const executionsBeforeBudget = toolExecutions.length;
  assert.equal(await adapter.sendMessage({
    sessionId,
    prompt: "budget",
    requestId: "prompt-budget",
    researchTools: true,
    allowedResearchTools: ["transcript_search", "transcript_read"],
    maxToolCalls: 3,
    toolBudgets: { transcript_search: 2, transcript_read: 1 },
  }), "预算内完成");
  assert.equal(toolExecutions.length - executionsBeforeBudget, 2, "excess searches must be denied without failing the whole turn");
  const budgetCalls = calls.filter((call) => call.body.messages?.[0]?.content === "budget");
  assert.equal(budgetCalls.length, 2);
  assert.deepEqual(budgetCalls[1].body.tools.map((tool) => tool.function.name), ["transcript_read"], "an exhausted search tool must be removed while read remains available");
  assert.equal(budgetCalls[1].body.messages.filter((message) => message.role === "tool" && message.content.includes("TOOL_BUDGET_EXHAUSTED")).length, 2);
  assert.ok(calls.every((call) => call.url === "/chat/completions"));
  assert.ok(calls.every((call) => call.auth === "Bearer ark-test-secret"));
  assert.ok(calls.every((call) => call.body.model === "glm-5.3-flash"));
  assert.deepEqual(calls.find((call) => call.body.messages?.[0]?.content === "tool").body.tools.map((tool) => tool.function.name), ["transcript_search", "transcript_read"]);
  const edgeAdapter = createHarnessClient({
    HARNESS_BASE_URL: `http://127.0.0.1:${port}`,
    HARNESS_API_STYLE: "openai-chat",
    VOLCENGINE_AGENT_PLAN_API_KEY: "ark-test-secret",
    HARNESS_MODEL: "glm-5.3-flash",
    SURVEYKIT_AGENT_TOOL_URL: `http://127.0.0.1:${port}/tools`,
    SURVEYKIT_TOOL_API_KEY: "tool-secret",
    HARNESS_TIMEOUT: "2000",
  });
  const edgeSessionId = await edgeAdapter.create("Edge GLM", "edge-create");
  assert.equal(await edgeAdapter.send(edgeSessionId, "edge-tool-schema", "edge-tool", { researchTools: true, allowedResearchTools: ["transcript_search", "transcript_read"], maxToolCalls: 2 }), "工具结果已验证");
  const edgeFirstCall = calls.find((call) => call.body.messages?.[0]?.content === "edge-tool-schema" && call.body.messages.length === 1);
  const searchSchema = edgeFirstCall.body.tools.find((tool) => tool.function.name === "transcript_search").function.parameters;
  const readSchema = edgeFirstCall.body.tools.find((tool) => tool.function.name === "transcript_read").function.parameters;
  assert.deepEqual(searchSchema.required, ["query"], "Cloudflare transcript_search must expose its required query field to GLM");
  assert.deepEqual(readSchema.required, ["transcript_id", "segment_id"]);
  assert.equal(calls.find((call) => call.url === "/tools/transcript_search").auth, "Bearer tool-secret");
  await assert.rejects(adapter.sendMessage({ sessionId, prompt: "quota", requestId: "prompt-4" }), (error) => error.code === "HARNESS_UPSTREAM" && error.status === 429);

  const missingKey = createHarnessAdapter({ env: { HARNESS_BASE_URL: `http://127.0.0.1:${port}`, HARNESS_API_STYLE: "openai-chat", HARNESS_MODEL: "glm-5.3-flash" } });
  assert.equal(missingKey.isConfigured(), false);
  console.log("harness-openai-chat-smoke: PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
