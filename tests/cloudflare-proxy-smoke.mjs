import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../functions/pptx-api/_proxy.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { proxyToBackend } = await import(moduleUrl);
const originalFetch = globalThis.fetch;

try {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const missing = await proxyToBackend(new Request("https://surveykit.cc/pptx-api/healthz"), {});
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error.message, /PPTX_BACKEND_URL/);

  const invalid = await proxyToBackend(new Request("https://surveykit.cc/pptx-api/healthz"), { PPTX_BACKEND_URL: "ftp://backend.example.com" });
  assert.equal(invalid.status, 500);
  assert.match((await invalid.json()).error.message, /配置无效/);

  const preflight = await proxyToBackend(new Request("https://surveykit.cc/pptx-api/preview", { method: "OPTIONS" }), {});
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /X-Project-Id/);
  assert.equal(fetchCalls, 0);

  let captured;
  globalThis.fetch = async (target, options) => {
    captured = { target: String(target), options };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const response = await proxyToBackend(
    new Request("https://surveykit.cc/pptx-api/preview?title=smoke", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Project-Id": "project-1" },
      body: Buffer.from("fixture"),
      duplex: "half",
    }),
    { PPTX_BACKEND_URL: "https://backend.example.com/", PPTX_PROXY_TIMEOUT_MS: "45000" },
  );
  assert.equal(response.status, 200);
  assert.equal(captured.target, "https://backend.example.com/api/pptx-report/preview?title=smoke");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.get("x-surveykit-proxy"), "cloudflare-pages");
  assert.equal(captured.options.headers.get("x-project-id"), "project-1");

  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  const forbidden = await proxyToBackend(new Request("https://surveykit.cc/pptx-api/healthz"), { PPTX_BACKEND_URL: "https://backend.example.com" });
  assert.equal(forbidden.status, 403);
  assert.match((await forbidden.json()).error.message, /拒绝访问/);

  console.log("Cloudflare PPTX proxy smoke passed: config, CORS, mapping and errors");
} finally {
  globalThis.fetch = originalFetch;
}
