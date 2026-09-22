import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/ai.js";
import { createRequire } from "node:module";
import http from "node:http";

const env = { OPENCODE_GO_API_KEY: "fake-go-key", SENSENOVA_API_KEY: "old-key" };
const body = { model: "mimo-v2.6-flash", messages: [{ role: "user", content: "test" }] };
const success = () => Response.json({ choices: [{ message: { content: "OK" } }] });

test("Cloudflare health lists Go only and never exposes its key", async () => {
  const response = await onRequest({ request: new Request("https://example.test/api/ai"), env });
  const data = await response.json();
  assert.deepEqual(data.configured_sources, [{ source: "builtin-opencode-go", models: ["deepseek-v4.1-flash", "mimo-v2.6-flash"] }]);
  assert.ok(!JSON.stringify(data).includes("fake-go-key"));
});

test("Cloudflare uses Go ahead of legacy builtins and preserves diagnostics", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://opencode.ai/zen/go/v1/chat/completions");
    assert.equal(JSON.parse(options.body).model, "mimo-v2.6-flash");
    return success();
  };
  try {
    const request = new Request("https://example.test/api/ai", {
      method: "POST", body: JSON.stringify({ provider: "opencode-go", taskTier: "fast", body })
    });
    const response = await onRequest({ request, env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-AI-Source"), "builtin-opencode-go");
    assert.equal(response.headers.get("X-AI-Task-Tier"), "fast");
    assert.ok(response.headers.get("X-AI-Request-ID"));
    await response.text();
  } finally { globalThis.fetch = previous; }
});

test("Node production handler forwards a Go response to an HTTP client", async () => {
  const { createAiProxyHandler } = createRequire(import.meta.url)("../lib/ai-proxy.js");
  const handler = createAiProxyHandler({ env, maxBodyBytes: 1048576, fetchImpl: async () => success() });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai`, {
      method: "POST", body: JSON.stringify({ provider: "opencode-go", body })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Actual-Model"), "mimo-v2.6-flash");
    assert.equal((await response.json()).choices[0].message.content, "OK");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
