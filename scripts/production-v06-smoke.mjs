import assert from "node:assert/strict";
import crypto from "node:crypto";

const base = String(process.env.SURVEYKIT_BASE_URL || "https://surveykit.cc").replace(/\/+$/, "");

async function jsonRequest(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (!response.ok) throw new Error(`${path} status=${response.status} body=${text.slice(0, 500)}`);
  return { status: response.status, payload };
}

let project = null;
try {
  const tag = crypto.randomUUID();
  let response = await jsonRequest("/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `V0.6 production smoke ${tag.slice(0, 8)}`, client_project_id: `deploy-smoke-${tag}` }),
  });
  project = response.payload.project;
  const projectPath = `/api/research/projects/${encodeURIComponent(project.id)}`;

  response = await jsonRequest(`${projectPath}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "请务必调用专业样本量工具：95%置信水平、3%误差、总体无限时，至少需要多少有效样本？",
      task_type: "free_chat",
      client_request_id: `sample-${tag}`,
    }),
  });
  assert.equal(response.status, 200);
  assert.ok((response.payload.tool_calls || []).some((item) => item.tool_id === "sample_size" && item.status === "completed"), "Harness did not complete sample_size");

  response = await jsonRequest(`/api/tools/results?project_id=${encodeURIComponent(project.id)}`);
  assert.ok(response.payload.data.results.some((item) => item.tool_id === "sample-size" && item.source === "agent"), "agent Tool Result missing");

  const rows = ["respondent_id,age,NPS"];
  for (let index = 1; index <= 40; index += 1) rows.push(`${index},18-24,10`);
  for (let index = 41; index <= 80; index += 1) rows.push(`${index},35-44,0`);
  response = await jsonRequest(`${projectPath}/files`, {
    method: "POST",
    headers: { "Content-Type": "text/csv", "X-Research-File-Name": encodeURIComponent("deployment-v06.csv"), "X-Research-File-Category": "data" },
    body: Buffer.from(rows.join("\n")),
  });
  const file = response.payload.file;

  response = await jsonRequest(`${projectPath}/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.id, name: "V0.6 smoke raw" }),
  });
  const rawDataset = response.payload.dataset;

  response = await jsonRequest(`${projectPath}/datasets/${encodeURIComponent(rawDataset.id)}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ async: true }),
  });
  assert.equal(response.status, 202);
  let job = response.payload.job;
  for (let attempt = 0; attempt < 80 && !["completed", "failed"].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = (await jsonRequest(`${projectPath}/data-jobs/${encodeURIComponent(job.id)}`)).payload.job;
  }
  assert.equal(job.status, "completed", job.error);

  const targets = [{ variable: "age", categories: [{ value: "18-24", share: 70 }, { value: "35-44", share: 30 }] }];
  response = await jsonRequest(`${projectPath}/datasets/${encodeURIComponent(rawDataset.id)}/weight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "rim", targets, confirmed: false }),
  });
  assert.equal(response.payload.data.requires_confirmation, true);

  response = await jsonRequest(`${projectPath}/datasets/${encodeURIComponent(rawDataset.id)}/weight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "rim", targets, confirmed: true, name: "V0.6 smoke weighted" }),
  });
  const weightedDatasetId = response.payload.data.weighted_dataset_id;
  assert.ok(weightedDatasetId);

  response = await jsonRequest(`${projectPath}/datasets/${encodeURIComponent(weightedDatasetId)}/crosstab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ banner: ["age"], variables: ["NPS"] }),
  });
  assert.equal(response.payload.data.weighted, true);
  assert.ok(response.payload.data.excel_file_id);

  const download = await fetch(`${base}${projectPath}/files/${encodeURIComponent(response.payload.data.excel_file_id)}/download`);
  assert.equal(download.status, 200);
  const workbook = new Uint8Array(await download.arrayBuffer());
  assert.deepEqual([...workbook.slice(0, 2)], [0x50, 0x4b]);

  console.log("production_v06_smoke=PASS");
  console.log("harness_tool=sample_size");
  console.log("dataset_job=completed");
  console.log("weight_and_crosstab=PASS");
  console.log("excel_download=PASS");
} finally {
  if (project) {
    const cleanup = await fetch(`${base}/api/research/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
    console.log(`cleanup_status=${cleanup.status}`);
    if (cleanup.status !== 204) throw new Error(`production smoke cleanup failed with ${cleanup.status}`);
  }
}
