import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createToolHandler } = require("../lib/tool-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-tool-gateway-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
await store.createProject("owner-a", { client_project_id: "owned-project", title: "Owned Project" });
await store.createProject("owner-b", { client_project_id: "foreign-project", title: "Foreign Project" });

function start(env) {
  const handler = createToolHandler({ env, store, logger: { log() {}, error() {} } });
  const server = http.createServer((request, response) => handler(request, response));
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function request(base, pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const cloudflare = await import("../functions/api/tools/[[path]].js");
let cloudflareResponse = await cloudflare.onRequest({
  request: new Request("https://surveykit.example/api/tools/sample-size", json({ input: { z: 1.96, marginPercent: 5, population: 0, segments: 1, responseRatePercent: 80 } })),
  env: { RESEARCH_AUTH_MODE: "anonymous", RESEARCH_ANONYMOUS_USER_ID: "smoke" },
});
assert.equal(cloudflareResponse.status, 200);
assert.equal((await cloudflareResponse.json()).data.base, 385, "Cloudflare execution must not require D1 or Harness");

const anonymous = await start({});
let result = await request(anonymous.base, "/api/tools");
assert.equal(result.response.status, 401);
assert.equal(result.payload.success, false);
assert.equal(result.payload.error.code, "UNAUTHORIZED");
anonymous.server.close();

const owner = await start({ TOOL_DEV_USER_ID: "owner-a", SURVEYKIT_TOOL_API_KEY: "agent-secret" });
try {
  result = await request(owner.base, "/api/tools");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.success, true);
  assert.deepEqual(result.payload.data.tools.map((tool) => tool.id), ["sample-size", "quota", "questionnaire-check", "data-profile", "data-clean", "data-weight", "crosstab"]);
  assert.ok(result.payload.data.tools.every((tool) => tool.deterministic && !tool.uses_ai));

  const sampleInput = { z: 1.96, marginPercent: 5, population: 0, segments: 1, responseRatePercent: 80 };
  result = await request(owner.base, "/api/tools/sample-size", json({ input: sampleInput }));
  assert.equal(result.response.status, 200);
  assert.deepEqual({ base: result.payload.data.base, gross: result.payload.data.gross, segment: result.payload.data.segment }, { base: 385, gross: 482, segment: 385 });
  assert.equal(result.payload.meta.uses_ai, false);

  result = await request(owner.base, "/api/tools/sample-size", json({ input: { ...sampleInput, marginPercent: 0 } }));
  assert.equal(result.response.status, 400);
  assert.equal(result.payload.error.code, "INVALID_INPUT");

  const quotaInput = { mode: "cross", total_sample: 401, dimensions: [
    { name: "性别", groups: [{ label: "男", share: 50 }, { label: "女", share: 50 }] },
    { name: "年龄", groups: [{ label: "18-29", share: 35 }, { label: "30-39", share: 35 }, { label: "40+", share: 30 }] },
  ] };
  result = await request(owner.base, "/api/tools/quota", json({ input: quotaInput }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.combination_count, 6);
  assert.equal(result.payload.data.flat.reduce((sum, item) => sum + item.sample, 0), 401);
  assert.equal(result.payload.data.matrix.cells.flat().reduce((sum, value) => sum + value, 0), 401);

  result = await request(owner.base, "/api/tools/questionnaire-check", json({ input: { text: "Q1. 您是否购买？\nA. 是 → 跳至 Q3\nB. 否", scenario: "general" } }));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.summary.errors, 1);
  assert.equal(result.payload.data.issues[0].type, "logic");
  assert.equal(result.payload.data.issues[0].level, "error");

  result = await request(owner.base, "/api/tools/sample-size/results", json({ project_id: "owned-project", input: sampleInput }));
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.tool_result.project_id, "owned-project");
  assert.equal(result.payload.data.tool_result.result.base, 385);

  result = await request(owner.base, "/api/tools/results?project_id=owned-project");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.results.length, 1);

  result = await request(owner.base, "/api/tools/sample-size/results", json({ project_id: "foreign-project", input: sampleInput }));
  assert.equal(result.response.status, 404);
  assert.equal(result.payload.error.code, "PROJECT_NOT_FOUND");

  await store.setSession("owned-project", "agent-harness-session");
  const agentBody = { harness_session_id: "agent-harness-session", call_id: "agent-call-1", arguments: { confidence_level: 0.95, margin_of_error: 0.03 } };
  result = await request(owner.base, "/api/tools/agent/sample_size", json(agentBody));
  assert.equal(result.response.status, 401, "internal endpoint must not accept the normal user session");
  result = await request(owner.base, "/api/tools/agent/sample_size", { ...json(agentBody), headers: { "Content-Type": "application/json", Authorization: "Bearer agent-secret" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.recommended_sample, 1068);
  assert.equal(result.payload.meta.project_saved, true);
  assert.equal(Object.hasOwn(result.payload.data, "user_id"), false);
  result = await request(owner.base, "/api/tools/agent/sample_size", { ...json(agentBody), headers: { "Content-Type": "application/json", Authorization: "Bearer agent-secret" } });
  assert.equal(result.payload.meta.replayed, true);
  result = await request(owner.base, "/api/tools/results?project_id=owned-project");
  assert.equal(result.payload.data.results.filter((item) => item.source === "agent").length, 1);

  const root = path.resolve(import.meta.dirname, "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const researcher = fs.readFileSync(path.join(root, "src/modules/ai-researcher/index.js"), "utf8");
  assert.match(app, /callToolGateway\("sample-size"/);
  assert.match(app, /callToolGateway\("quota"/);
  assert.match(app, /callToolGateway\("questionnaire-check"/);
  assert.match(html, /data-save-tool-result="sample-size"/);
  assert.match(html, /data-research-tool="questionnaire-check"/);
  assert.match(researcher, /openToolFromProject/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "lib/tools/registry.mjs"), "utf8"), /harness|deepseek|prompt/i);
} finally {
  owner.server.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("tool gateway smoke ok");
