import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAiProxyHandler } = require("../lib/ai-proxy");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const env = { DASHSCOPE_API_KEY: "server-secret" };
let mode = "normal";
let calls = [];
const fetchImpl = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url: String(url), options, body });
  const gatewayCalls = calls.filter((call) => call.url.includes("api.surveykit.cc")).length;
  if (mode === "gateway-quota-once" && String(url).includes("api.surveykit.cc") && gatewayCalls === 1) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota." } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "gateway-down" && String(url).includes("api.surveykit.cc")) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota." } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "network" && body.model === "deepseek-v4-pro") throw new TypeError("socket reset");
  const isChannelProbe = body.messages?.some((message) => String(message.content || "").includes("channel-health-probe"));
  if (mode === "channel-probe" && isChannelProbe) {
    const response = () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    if (String(url).includes("api.surveykit.cc")) {
      return new Promise((resolve) => setTimeout(() => resolve(response()), 40));
    }
    return response();
  }  if (body.stream) {
    return new Response('data: {"choices":[{"delta":{"content":"stream-ok"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  const content = mode === "structured" && /^deepseek-v4-/.test(body.model)
    ? "not-json"
    : '{"ok":true}';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
const handler = createAiProxyHandler({ env, maxBodyBytes: 1024, fetchImpl });
const server = http.createServer(handler);
const port = await listen(server);

function payload(overrides = {}, taskTier = "") {
  return {
    provider: "deepseek",
    url: "https://api.deepseek.com/v1/chat/completions",
    apiKey: "",
    ...(taskTier ? { taskTier } : {}),
    body: {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "test" }],
      ...overrides,
    },
  };
}

try {
  let response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-actual-model"), "deepseek-v4-pro");
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-secret");

  env.SURVEYKIT_GATEWAY_API_KEY = "gateway-secret";
  env.SENSENOVA_API_KEY = "sense-secret";

  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({}, "quality")),
  });
  assert.equal(calls[0].body.model, "deepseek-v4-pro");
  assert.equal(response.headers.get("x-ai-source"), "builtin-bailian");
  assert.equal(response.headers.get("x-ai-task-tier"), "quality");

  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({}, "fast")),
  });
  assert.equal(calls[0].body.model, "deepseek-v4-flash");
  assert.equal(response.headers.get("x-ai-source"), "builtin-surveykit-gateway");
  assert.equal(response.headers.get("x-ai-task-tier"), "fast");

  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://api.surveykit.cc/v1/chat/completions");
  assert.equal(calls[0].body.model, "deepseek-v4-flash");
  assert.equal(calls[0].options.headers.Authorization, "Bearer gateway-secret");
  assert.equal(response.headers.get("x-ai-source"), "builtin-surveykit-gateway");
  assert.equal(response.headers.get("x-ai-attempts"), "deepseek-v4-flash");
  mode = "gateway-quota-once";
  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-source"), "builtin-surveykit-gateway");
  assert.equal(calls.length, 2);
  assert.equal(response.headers.get("x-ai-attempts"), "deepseek-v4-flash,deepseek-v4-flash");

  mode = "gateway-down";
  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-source"), "builtin-sensenova");
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, "https://token.sensenova.cn/v1/chat/completions");
  mode = "normal";

  delete env.SURVEYKIT_GATEWAY_API_KEY;
  delete env.SENSENOVA_API_KEY;

  env.SENSENOVA_API_KEY = "sense-secret";
  calls = [];
  response = await fetch("http://127.0.0.1:" + port + "/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://token.sensenova.cn/v1/chat/completions");
  assert.equal(calls[0].body.model, "deepseek-v4-flash");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sense-secret");
  assert.equal(response.headers.get("x-ai-source"), "builtin-sensenova");
  assert.equal(response.headers.get("x-ai-attempts"), "deepseek-v4-flash");
  delete env.SENSENOVA_API_KEY;

  env.SURVEYKIT_GATEWAY_API_KEY = "gateway-secret";
  env.SENSENOVA_API_KEY = "sense-secret";
  calls = [];
  mode = "channel-probe";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({ response_format: { type: "json_object" } }, "structured")),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-source"), "builtin-sensenova");
  const probeCalls = calls.filter((call) => call.body.messages.some((message) => String(message.content || "").includes("channel-health-probe")));
  const reportCalls = calls.filter((call) => !call.body.messages.some((message) => String(message.content || "").includes("channel-health-probe")));
  assert.equal(probeCalls.length, 2);
  assert.equal(reportCalls.length, 1);
  assert.match(reportCalls[0].url, /sensenova\.cn/);
  delete env.SURVEYKIT_GATEWAY_API_KEY;
  delete env.SENSENOVA_API_KEY;
  calls = [];
  mode = "structured";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({ response_format: { type: "json_object" } }, "structured")),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-actual-model"), "qwen3.7-max");
  assert.equal(response.headers.get("x-ai-task-tier"), "structured");
  assert.deepEqual(calls.map((call) => call.body.model), ["deepseek-v4-flash", "qwen3.7-max"]);

  calls = [];
  mode = "structured";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({ response_format: { type: "json_object" } })),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-actual-model"), "qwen3.7-max");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[1].body.response_format, undefined);
  assert.equal(calls[2].body.response_format.type, "json_object");

  calls = [];
  mode = "network";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-actual-model"), "deepseek-v4-flash");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].options.signal);

  calls = [];
  mode = "normal";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({ stream: true })),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(await response.text(), /stream-ok/);

  calls = [];
  mode = "normal";
  const userPayload = payload();
  userPayload.apiKey = "user-secret";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userPayload),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer user-secret");

  const insecureUserGateway = payload();
  insecureUserGateway.apiKey = "user-secret";
  insecureUserGateway.provider = "surveykit_gateway";
  insecureUserGateway.url = "http://api.surveykit.cc/v1/chat/completions";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(insecureUserGateway),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /HTTPS/);

  const mismatched = payload();
  mismatched.apiKey = "user-secret";
  mismatched.url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mismatched),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /does not match/);

  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad-json",
  });
  assert.equal(response.status, 400);

  delete env.DASHSCOPE_API_KEY;
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 503);

  response = await fetch(`http://127.0.0.1:${port}/api/ai`);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");

  console.log("Local AI proxy module smoke passed: fallback, user key, validation and errors");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
