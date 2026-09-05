import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-vite-api-"));
const previousCwd = process.cwd();
const previousEnv = { ...process.env };
let server;
try {
  // Load no personal .env files or model credentials. This test never calls a provider.
  process.chdir(temporary);
  for (const key of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET/.test(key)) delete process.env[key];
  process.env.AI_PROXY_MAX_BODY_BYTES = "1024";
  process.env.RESEARCH_DATA_FILE = path.join(temporary, "research.json");
  process.env.RESEARCH_FILES_DIR = path.join(temporary, "files");
  server = await createServer({
    root, configFile: path.join(root, "vite.config.js"), logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, preTransformRequests: false },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  assert.equal(server.config.server.proxy?.["/api/ai"], undefined);
  const health = await fetch(`${base}/api/ai?probe=1`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const info = await health.json();
  assert.equal(info.service, "ai-proxy"); assert.deepEqual(info.configured_sources, []);
  const missingKey = await fetch(`${base}/api/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: { model: "fixture", messages: [{ role: "user", content: "fixture" }] } }), signal: AbortSignal.timeout(5000) });
  assert.equal(missingKey.status, 503); assert.equal((await missingKey.json()).error.type, "not_configured");
  const invalid = await fetch(`${base}/api/ai`, { method: "POST", body: "{}", signal: AbortSignal.timeout(5000) });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.type, "invalid_request");
  const oversized = await fetch(`${base}/api/ai`, { method: "POST", body: "x".repeat(2048), signal: AbortSignal.timeout(5000) });
  assert.equal(oversized.status, 413); await oversized.text();
  console.log("Vite AI runtime passed: direct health handler, missing-key 503, invalid-request 400, size-limit 413; no separate backend or provider calls.");
} finally {
  if (server) await server.close();
  process.chdir(previousCwd);
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("surveykit-vite-api-")) await fs.rm(temporary, { recursive: true, force: true });
}
