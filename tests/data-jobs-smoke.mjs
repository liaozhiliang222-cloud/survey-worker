import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createDataToolExecutor, registerRawDataset } from "../lib/data-engine.mjs";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");
const { LocalResearchFileStorage } = require("../lib/research-file-storage.js");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-data-job-"));
const storePath = path.join(temporary, "research.json");
const store = new JsonResearchStore(storePath);
const storage = new LocalResearchFileStorage(path.join(temporary, "files"));
const userId = "data-job-owner";
const project = await store.createProject(userId, { title: "异步数据任务" });
const csv = new TextEncoder().encode("respondent_id,age,NPS\n1,18-24,10\n2,35-44,0\n");
const fileId = crypto.randomUUID();
const storagePath = storage.key(project.id, fileId, "csv");
await storage.put(storagePath, csv);
const file = await store.createFile(userId, project.id, { id: fileId, file_name: "raw.csv", file_type: "csv", mime_type: "text/csv", file_size: csv.byteLength, category: "data", storage_path: storagePath });
const dataset = await registerRawDataset({ store, fileStorage: storage, userId, projectId: project.id, file });
const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: userId, RESEARCH_DATA_ASYNC_CELL_THRESHOLD: "2000000" }, store, fileStorage: storage, harnessAdapter: {}, logger: { log() {}, error() {} } });
const server = http.createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const submitted = await fetch(`${base}/api/research/projects/${project.id}/datasets/${dataset.id}/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ async: true }) });
  const submittedText = await submitted.text();
  assert.equal(submitted.status, 202, submittedText);
  const { job: initialJob } = JSON.parse(submittedText);
  assert.equal(initialJob.status, "pending");
  assert.equal(initialJob.tool_id, "data_profile");

  let job = initialJob;
  for (let attempt = 0; attempt < 100 && !["completed", "failed"].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fetch(`${base}/api/research/projects/${project.id}/data-jobs/${job.id}`);
    assert.equal(response.status, 200);
    job = (await response.json()).job;
  }
  assert.equal(job.status, "completed", job.error);
  assert.equal(job.progress, 100);
  assert.equal(job.result.data.sample_size, 2);
  assert.equal(job.input, undefined, "job API must not expose the raw submitted input");

  await createDataToolExecutor({ store, fileStorage: storage })({ agentToolId: "crosstab", args: { dataset_id: dataset.id, banner: ["age"], variables: ["NPS"] }, scope: { project, user_id: userId } });
  const exportedResponse = await fetch(`${base}/api/research/projects/${project.id}/datasets/${dataset.id}/crosstab-export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const exportedText = await exportedResponse.text();
  assert.equal(exportedResponse.status, 201, exportedText);
  const exported = JSON.parse(exportedText);
  assert.equal(exported.variable_count, 1);
  assert.equal(exported.analysis_count, 1);
  assert.ok(exported.file.id);
  const workbookResponse = await fetch(`${base}/api/research/projects/${project.id}/files/${exported.file.id}/download`);
  assert.equal(workbookResponse.status, 200);
  assert.deepEqual([...new Uint8Array(await workbookResponse.arrayBuffer()).slice(0, 2)], [0x50, 0x4b]);

  const invalidWeight = await fetch(`${base}/api/research/projects/${project.id}/datasets/${dataset.id}/weight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: false }) });
  assert.equal(invalidWeight.status, 400);
  assert.equal((await invalidWeight.json()).error.type, "data_tool_input");

  const reloaded = new JsonResearchStore(storePath);
  const persisted = await reloaded.getDataJob(project.id, job.id);
  assert.equal(persisted.status, "completed");
  assert.equal(JSON.parse(persisted.result).data.sample_size, 2);
  console.log("data jobs smoke passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
