import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { accessServiceHeaders, createResearchFetch } from "../scripts/lib/research-access.mjs";

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
let researchMode = "protected";
let redirectLocation = "https://test.cloudflareaccess.com/cdn-cgi/access/login";
let authenticatedRequests = 0;
let backendRevision = "smoke-revision";
const server = http.createServer((request, response) => {
  if (request.url === "/api/research/projects") {
    if (request.headers["cf-access-client-id"]) {
      authenticatedRequests++;
      assert.equal(request.headers["cf-access-client-id"], "test-client");
      assert.equal(request.headers["cf-access-client-secret"], "test-secret");
      response.writeHead(researchMode === "auth-failed" ? 401 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(researchMode === "auth-failed" ? { error: "unauthorized" } : { projects: [] }));
    } else if (researchMode === "exposed") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ projects: [{ title: "PRIVATE-CUSTOMER-DATA" }] }));
    } else if (researchMode === "unavailable") {
      response.writeHead(503); response.end("unavailable");
    } else {
      response.writeHead(302, { Location: redirectLocation }); response.end();
    }
    return;
  }
  const payloads = {
    "/healthz": { ok: true, service: "surveykit-web", release: { version: "smoke-1", revision: "smoke-revision" } },
    "/pptx-api/healthz": {
      ok: true,
      service: "pptx-report",
      release: { version: "smoke-1", revision: backendRevision },
      proxy: { ok: true, release: { version: "smoke-1", revision: "smoke-revision" } },
    },
    "/api/ai": { ok: true, service: "ai-proxy", release: { version: "smoke-1", revision: "smoke-revision" } },
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
async function runCheck(extraEnv = {}) {
const child = spawn(process.execPath, [
  "scripts/release-check.mjs",
  `--base-url=http://127.0.0.1:${port}`,
  "--release=smoke-1",
  "--revision=smoke-revision",
], { cwd: root, env: { ...process.env, CF_ACCESS_CLIENT_ID: "", CF_ACCESS_CLIENT_SECRET: "", ...extraEnv },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
assert.doesNotMatch(output, /PRIVATE-CUSTOMER-DATA|test-secret/);
return { exitCode, output, summary: JSON.parse(output) };
}
try {
const { exitCode, output, summary } = await runCheck();
assert.equal(exitCode, 0, output);
assert.equal(summary.ok, true);
assert.equal(summary.checks.length, 4);
assert.equal(summary.checks[3].authenticated_checked, false);

const credentials = { CF_ACCESS_CLIENT_ID: "test-client", CF_ACCESS_CLIENT_SECRET: "test-secret" };
const authenticated = await runCheck(credentials);
assert.equal(authenticated.exitCode, 0, authenticated.output);
assert.equal(authenticated.summary.checks[3].authenticated_checked, true);
assert.equal(authenticatedRequests, 1);
researchMode = "auth-failed";
assert.equal((await runCheck(credentials)).exitCode, 1);
researchMode = "exposed";
assert.equal((await runCheck()).exitCode, 1);
assert.equal((await runCheck(credentials)).exitCode, 1, "service auth must not hide an anonymous exposure");
researchMode = "unavailable";
assert.equal((await runCheck()).exitCode, 1);
researchMode = "protected";
for (const invalid of ["https://test.cloudflareaccess.com.attacker.test/login", "http://test.cloudflareaccess.com/login", "/login", "https://attacker@test.cloudflareaccess.com/login"]) {
  redirectLocation = invalid;
  assert.equal((await runCheck()).exitCode, 1, invalid);
}
redirectLocation = "https://test.cloudflareaccess.com/cdn-cgi/access/login";
assert.equal((await runCheck({ CF_ACCESS_CLIENT_ID: "test-client" })).exitCode, 1);
backendRevision = "stale-backend";
assert.equal((await runCheck()).exitCode, 1);
} finally { await new Promise((resolve) => server.close(resolve)); }

assert.throws(() => accessServiceHeaders({ CF_ACCESS_CLIENT_SECRET: "partial" }), /必须同时设置/);
const calls = [];
const researchFetch = createResearchFetch("https://surveykit.cc", {
  env: { CF_ACCESS_CLIENT_ID: "client", CF_ACCESS_CLIENT_SECRET: "secret" },
  fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response("{}"); },
});
await researchFetch("https://surveykit.cc/api/research/projects/p/files", { method: "POST", headers: { "Content-Type": "text/csv" } });
assert.equal(calls[0].options.redirect, "manual");
assert.equal(calls[0].options.headers.get("CF-Access-Client-Secret"), "secret");
assert.equal(calls[0].options.headers.get("Content-Type"), "text/csv");
for (const url of ["https://other.test/api/research/projects", "https://surveykit.cc/api/ai"]) {
  await researchFetch(url);
  assert.equal(calls.at(-1).options.headers, undefined, "credentials must stay on research origin and routes");
}
const loginFetch = createResearchFetch("https://surveykit.cc", {
  env: {}, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://test.cloudflareaccess.com/login" } }),
});
await assert.rejects(loginFetch("https://surveykit.cc/api/research/projects"), /CF_ACCESS_CLIENT_ID/);

console.log("Release process smoke passed: backup, rollback and production verification");
