import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Local server did not start in time.")), 10_000);
    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes("Research toolbox running")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local server exited before readiness with code ${code}: ${output}`));
    });
  });
}

function postChunked(port, urlPath, chunks) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: urlPath,
      method: "POST",
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" }
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(responseChunks).toString("utf8")
      }));
    });
    request.on("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

const backendRequests = [];
const backend = http.createServer((req, res) => {
  backendRequests.push({ method: req.method, url: req.url });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, path: req.url }));
});

const backendPort = await listen(backend);
const appPort = await freePort();
const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(appPort),
    PPTX_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    AI_PROXY_MAX_BODY_BYTES: "1024",
    PPTX_PROXY_MAX_BODY_BYTES: "1024"
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

try {
  await waitForReady(child);

  const appHealth = await fetch(`http://127.0.0.1:${appPort}/healthz`);
  assert.equal(appHealth.status, 200);
  assert.deepEqual(await appHealth.json(), {
    ok: true,
    service: "surveykit-web",
    pptx_backend_configured: true
  });

  const backendHealth = await fetch(`http://127.0.0.1:${appPort}/pptx-api/healthz?probe=1`);
  assert.equal(backendHealth.status, 200);
  assert.equal((await backendHealth.json()).path, "/healthz?probe=1");

  const oversizedPptx = await fetch(`http://127.0.0.1:${appPort}/pptx-api/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(1025, 1)
  });
  assert.equal(oversizedPptx.status, 413);
  assert.equal((await oversizedPptx.json()).error.code, "REQUEST_BODY_TOO_LARGE");

  const oversizedAi = await fetch(`http://127.0.0.1:${appPort}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.alloc(1025, 1)
  });
  assert.equal(oversizedAi.status, 413);
  assert.equal((await oversizedAi.json()).error.code, "REQUEST_BODY_TOO_LARGE");

  const chunkedAi = await postChunked(appPort, "/api/ai", [
    Buffer.alloc(600, 1),
    Buffer.alloc(600, 2)
  ]);
  assert.equal(chunkedAi.status, 413);
  assert.equal(JSON.parse(chunkedAi.body).error.code, "REQUEST_BODY_TOO_LARGE");

  const preview = await fetch(`http://127.0.0.1:${appPort}/pptx-api/preview?title=smoke`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from("fixture")
  });
  const previewText = await preview.text();
  assert.equal(preview.status, 200, previewText);
  assert.equal(JSON.parse(previewText).path, "/api/pptx-report/preview?title=smoke");
  assert.deepEqual(backendRequests.map((item) => item.url), [
    "/healthz?probe=1",
    "/api/pptx-report/preview?title=smoke"
  ]);

  console.log("Server route smoke passed: health, proxy mappings and 413 body limits");
} finally {
  child.kill();
  await new Promise((resolve) => backend.close(resolve));
}
