import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-qual-ppt-artifact-"));
const store = new JsonResearchStore(path.join(tmp, "research.json"));
const owner = "owner";
const project = await store.createProject(owner, { client_project_id: "qual-ppt", title: "定性 PPT 验收" });
const other = await store.createProject(owner, { client_project_id: "other", title: "其他项目" });
const analysis = await store.createArtifact(project.id, { type: "qualitative_analysis", title: "定性分析", content: "{}" });
const foreignAnalysis = await store.createArtifact(other.id, { type: "qualitative_analysis", title: "外部分析", content: "{}" });
const outline = await store.createArtifact(project.id, { type: "report_outline", title: "报告大纲", content: "{}" });
const script = await store.createArtifact(project.id, { type: "ppt_script", title: "PPT Script", content: "{}" });
const file = await store.createFile(owner, project.id, { file_name: "report.pptx", file_type: "pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", file_size: 100, category: "other", storage_path: "project/report.pptx" });
const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: owner }, store, harnessAdapter: { isConfigured() { return false; } }, logger: { log() {}, error() {} } });
const server = http.createServer(handler);

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/research/projects/${project.id}/artifacts`;
  const metadata = { schema_version: "surveykit.qualitative_ppt.v1", file_id: file.id, source_report_outline: outline.id, source_ppt_script: script.id, source_analysis_artifacts: [analysis.id], slide_count: 15, render_llm_tokens: 0 };
  const create = async (content, parent = undefined) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "qualitative_ppt", title: "定性报告 PPT", content: JSON.stringify(content), parent_artifact_id: parent }) });
  const firstResponse = await create(metadata);
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).artifact;
  assert.equal(first.version, 1);
  const secondResponse = await create(metadata, first.id);
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()).artifact;
  assert.equal(second.version, 2);
  assert.equal(second.parent_artifact_id, first.id);
  const rejected = await create({ ...metadata, source_analysis_artifacts: [foreignAnalysis.id] });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.type, "invalid_qualitative_ppt_lineage");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("qualitative-ppt-artifact-smoke: ok");
