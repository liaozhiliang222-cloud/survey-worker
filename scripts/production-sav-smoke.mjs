import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SavWriter } from "savfilewriter";

const base = String(process.env.SURVEYKIT_BASE_URL || "https://surveykit.cc").replace(/\/+$/, "");

async function jsonRequest(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (!response.ok) throw new Error(`${path} status=${response.status} body=${text.slice(0, 800)}`);
  return { status: response.status, payload };
}

const sav = SavWriter.write({
  encoding: "UTF-8",
  fileLabel: "SurveyKit production SAV smoke",
  sysvars: [
    { name: "respondent_id", type: 0, label: "受访者编号", printFormat: "F8.0" },
    { name: "gender", type: 0, label: "性别", printFormat: "F1.0", values: { 1: "男性", 2: "女性" } },
    { name: "nps", type: 0, label: "推荐意愿", printFormat: "F2.0" },
    { name: "city", type: 24, label: "常住城市" },
  ],
}, [
  { respondent_id: 1, gender: 1, nps: 9, city: "上海" },
  { respondent_id: 2, gender: 2, nps: 10, city: "北京" },
  { respondent_id: 3, gender: 2, nps: null, city: "广州" },
]);

let project = null;
try {
  const tag = crypto.randomUUID();
  let response = await jsonRequest("/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `SAV production smoke ${tag.slice(0, 8)}`,
      client_project_id: `deploy-sav-smoke-${tag}`,
    }),
  });
  project = response.payload.project;
  const projectPath = `/api/research/projects/${encodeURIComponent(project.id)}`;

  response = await jsonRequest(`${projectPath}/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-spss-sav",
      "X-Research-File-Name": encodeURIComponent("deployment-sav-smoke.sav"),
      "X-Research-File-Category": "data",
    },
    body: Buffer.from(sav),
  });
  assert.equal(response.status, 201);
  const file = response.payload.file;
  assert.equal(file.file_type, "sav");

  response = await jsonRequest(`${projectPath}/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.id, name: "SAV production raw" }),
  });
  assert.equal(response.status, 201);
  const dataset = response.payload.dataset;
  assert.equal(dataset.row_count, 3);
  assert.equal(dataset.column_count, 4);
  assert.equal(dataset.metadata.source_format, "sav");
  const datasetGender = dataset.metadata.variables.find((item) => item.name === "GENDER");
  assert.equal(datasetGender?.label, "性别");
  assert.deepEqual(datasetGender?.value_labels, [
    { value: "1", label: "男性" },
    { value: "2", label: "女性" },
  ]);

  response = await jsonRequest(`${projectPath}/datasets/${encodeURIComponent(dataset.id)}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 201);
  assert.equal(response.payload.data.sample_size, 3);
  assert.ok(response.payload.data.field_index.includes("GENDER"));
  const profileGender = response.payload.data.field_metadata.find((item) => item.field === "GENDER");
  assert.equal(profileGender?.label, "性别");
  assert.deepEqual(profileGender?.value_labels, [
    { value: "1", label: "男性" },
    { value: "2", label: "女性" },
  ]);

  response = await jsonRequest(`${projectPath}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "请只调用 data_profile 检查当前 SAV 数据集，不要清洗、加权或做交叉表。请简要说明样本量、字段数，以及性别变量的题目标签和值标签。",
      task_type: "data_analysis",
      dataset_id: dataset.id,
      client_request_id: `sav-profile-${tag}`,
    }),
  });
  assert.equal(response.status, 200);
  const harnessProfile = (response.payload.tool_calls || []).find(
    (item) => item.tool_id === "data_profile" && item.status === "completed",
  );
  assert.ok(harnessProfile, "Harness did not complete data_profile for the SAV dataset");
  assert.equal(response.payload.applied_context?.raw_rows_included, false);
  assert.equal(response.payload.applied_context?.dataset_id, dataset.id);

  response = await jsonRequest(`/api/tools/results?project_id=${encodeURIComponent(project.id)}`);
  const agentProfile = response.payload.data.results.find(
    (item) => item.tool_id === "data-profile" && item.source === "agent",
  );
  assert.ok(agentProfile, "Harness data_profile Tool Result was not persisted");
  assert.equal(agentProfile.result.sample_size, 3);
  const agentGender = agentProfile.result.field_metadata.find((item) => item.field === "GENDER");
  assert.equal(agentGender?.label, "性别");

  console.log("production_sav_smoke=PASS");
  console.log("sav_upload_and_registration=PASS");
  console.log("direct_data_profile=PASS");
  console.log("harness_data_profile=PASS");
  console.log("raw_rows_in_ai_context=false");
} finally {
  if (project) {
    const cleanup = await fetch(`${base}/api/research/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
    });
    console.log(`cleanup_status=${cleanup.status}`);
    if (cleanup.status !== 204) throw new Error(`production SAV smoke cleanup failed with ${cleanup.status}`);
  }
}
