import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const install = await fs.readFile(new URL("../deploy/install_seoul.sh", import.meta.url), "utf8");
const rollback = await fs.readFile(new URL("../deploy/rollback_seoul.sh", import.meta.url), "utf8");
const checker = await fs.readFile(new URL("../scripts/release-check.mjs", import.meta.url), "utf8");
const docs = await fs.readFile(new URL("../docs/RELEASE_PROCESS.md", import.meta.url), "utf8");

assert.match(install, /BACKUP_DIR/);
assert.match(install, /RELEASE\.json/);
assert.match(install, /systemctl restart/);
assert.match(install, /tail -n \+6/);
assert.match(install, /listen 443 ssl/);
assert.match(install, /--resolve/);
assert.match(install, /seq 1 20/);
assert.match(rollback, /realpath/);
assert.match(rollback, /deploy\/aliyun_api\.py/);
assert.match(rollback, /curl --fail/);
assert.match(checker, /\/pptx-api\/healthz/);
assert.match(checker, /\/api\/ai/);
assert.match(checker, /\/api\/research\/projects/);
assert.match(docs, /PPTX_BACKEND_URL=https:\/\//);
assert.match(docs, /verify:production/);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((request, response) => {
  const payloads = {
    "/healthz": { ok: true, service: "surveykit-web", release: { version: "smoke-1" } },
    "/pptx-api/healthz": {
      ok: true,
      service: "pptx-report",
      release: { version: "smoke-1" },
      proxy: { ok: true, release: { version: "smoke-1" } },
    },
    "/api/ai": { ok: true, service: "ai-proxy", release: { version: "smoke-1" } },
    "/api/research/projects": { projects: [] },
  };
  const payload = payloads[request.url];
  response.writeHead(payload ? 200 : 404, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload || { error: "not found" }));
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const child = spawn(process.execPath, [
  "scripts/release-check.mjs",
  `--base-url=http://127.0.0.1:${port}`,
  "--release=smoke-1",
], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
await new Promise((resolve) => server.close(resolve));
assert.equal(exitCode, 0, output);
const summary = JSON.parse(output);
assert.equal(summary.ok, true);
assert.equal(summary.checks.length, 4);

console.log("Release process smoke passed: backup, rollback and production verification");
