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

function payload(overrides = {}) {
  return {
    provider: "deepseek",
    url: "https://api.deepseek.com/v1/chat/completions",
    apiKey: "",
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

  calls = [];
  mode = "structured";
  response = await fetch(`http://127.0.0.1:${port}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload({ response_format: { type: "json_object" } })),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-actual-model"), "qwen3.7-plus");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[1].body.response_format, undefined);
  assert.equal(calls[2].body.response_format.type, "json_object");

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
