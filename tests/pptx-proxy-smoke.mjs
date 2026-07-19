import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPptxProxyHandler } = require("../lib/pptx-proxy");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const backendRequests = [];
const backend = http.createServer((req, res) => {
  backendRequests.push(req.url);
  if (req.url.includes("/slow")) {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    }, 100);
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ path: req.url }));
});
const backendPort = await listen(backend);
const handler = createPptxProxyHandler({
  backendUrl: `http://127.0.0.1:${backendPort}`,
  timeoutMs: 25,
  maxBodyBytes: 1024,
});
const proxy = http.createServer(handler);
const proxyPort = await listen(proxy);

try {
  const preview = await fetch(`http://127.0.0.1:${proxyPort}/pptx-api/preview?title=module`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from("fixture"),
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).path, "/api/pptx-report/preview?title=module");

  const oversized = await fetch(`http://127.0.0.1:${proxyPort}/pptx-api/parse`, {
    method: "POST",
    body: Buffer.alloc(1025, 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "REQUEST_BODY_TOO_LARGE");

  const timedOut = await fetch(`http://127.0.0.1:${proxyPort}/pptx-api/slow`);
  assert.equal(timedOut.status, 502);
  assert.match((await timedOut.json()).error.message, /超时/);
  assert.deepEqual(backendRequests.slice(0, 2), [
    "/api/pptx-report/preview?title=module",
    "/api/pptx-report/slow",
  ]);

  console.log("PPTX proxy module smoke passed: mapping, 413 and timeout");
} finally {
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => backend.close(resolve));
}
