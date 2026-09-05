import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readSseResponse } from "../src/modules/ai-researcher/stream.mjs";

const base = String(process.env.SURVEYKIT_BASE_URL || "https://surveykit.cc").replace(/\/+$/, "");
const sourcePath = process.env.SURVEYKIT_SAV_FILE || process.argv[2];
if (!sourcePath) throw new Error("Set SURVEYKIT_SAV_FILE or pass a real SAV path.");

async function jsonRequest(route, options = {}, timeoutMs = 30_000) {
  const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const responseText = await response.text();
  let payload = null;
  try { payload = responseText ? JSON.parse(responseText) : null; } catch { /* reported below */ }
  if (!response.ok) throw new Error(`${route} status=${response.status} body=${responseText.slice(0, 1_200)}`);
  return { status: response.status, payload };
}

async function streamMessage(route, body) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(360_000),
  });
  if (!response.ok) throw new Error(`${route} status=${response.status} body=${(await response.text()).slice(0, 1_200)}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) return (await response.json()).data;
  let read;
  try { read = await readSseResponse(response); }
  catch (error) {
    if (!error.runId) throw error;
    const projectPath = route.replace(/\/messages$/, "");
    const deadline = Date.now() + 330_000;
    while (Date.now() < deadline) {
      const snapshot = await jsonRequest(`${projectPath}/runs/${encodeURIComponent(error.runId)}`);
      const run = snapshot.payload.run;
      if (run?.status === "completed" && run.result) return run.result;
      if (run?.status === "failed") throw new Error(`background run failed: ${run.error?.type || "unknown"} ${run.error?.message || ""}; partial=${String(run.partial_content || error.partialContent || "").slice(0, 800)}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`background run recovery timed out; partial=${String(error.partialContent || "").slice(0, 800)}`);
  }
  return read.result;
}

const bytes = await fs.readFile(sourcePath);
let project = null;
try {
  const tag = crypto.randomUUID();
  let response = await jsonRequest("/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Wide SAV production smoke ${tag.slice(0, 8)}`, client_project_id: `deploy-wide-sav-${tag}` }),
  });
  project = response.payload.project;
  const projectPath = `/api/research/projects/${encodeURIComponent(project.id)}`;

  response = await jsonRequest(`${projectPath}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/x-spss-sav", "X-Research-File-Name": encodeURIComponent(path.basename(sourcePath)), "X-Research-File-Category": "data" },
    body: bytes,
  }, 60_000);
  const file = response.payload.file;

  response = await jsonRequest(`${projectPath}/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.id, name: "Wide SAV production raw" }),
  }, 60_000);
  const dataset = response.payload.dataset;
  assert.equal(dataset.row_count, 3_600);
  assert.equal(dataset.column_count, 474);

  const messageResult = await streamMessage(`${projectPath}/messages`, {
      message: "请严格完成两步且每个工具只调用一次：第一步调用 data_profile，并将 field_query 设为 [\"NPS\",\"推荐\"]、field_limit 设为 40，确认完整字典中的 NPS 变量；第二步调用 crosstab，以 FZ_Q1 为 banner、Q12__1 为 variables。不要清洗或加权。最终简短报告两个可追溯 result_id。",
      task_type: "data_analysis",
      dataset_id: dataset.id,
      client_request_id: `wide-sav-analysis-${tag}`,
  });
  const calls = messageResult.tool_calls || [];
  assert.ok(calls.some((item) => item.tool_id === "data_profile" && item.status === "completed"), "Harness data_profile must complete");
  assert.ok(calls.some((item) => item.tool_id === "crosstab" && item.status === "completed"), "Harness crosstab must complete");

  response = await jsonRequest(`/api/tools/results?project_id=${encodeURIComponent(project.id)}`);
  const agentResults = response.payload.data.results.filter((item) => item.source === "agent");
  assert.equal(agentResults.filter((item) => item.tool_id === "data-profile").length, 1, "one Harness data_profile call must persist exactly one Tool Result");
  assert.equal(agentResults.filter((item) => item.tool_id === "crosstab").length, 1, "one Harness crosstab call must persist exactly one Tool Result");
  const agentProfile = agentResults.find((item) => item.tool_id === "data-profile");
  assert.equal(agentProfile.result.field_count_total, 474);
  assert.equal(agentProfile.result.field_index_returned, 474);
  assert.equal(agentProfile.result.fields_truncated, false);
  assert.ok(agentProfile.result.field_metadata.some((item) => item.field === "Q12__1" && /推荐/.test(item.label)), "Harness must discover Q12__1 by its SAV question label");
  const crosstab = agentResults.find((item) => item.tool_id === "crosstab");
  assert.ok(crosstab?.result?.result_id);
  assert.ok(crosstab?.result?.excel_file_id);

  process.stdout.write(`${JSON.stringify({ production_wide_sav_smoke: "PASS", project_id: project.id, rows: dataset.row_count, columns: dataset.column_count, nps_field: "Q12__1", tool_calls: calls.map((item) => ({ tool_id: item.tool_id, status: item.status })), agent_result_count: agentResults.length, crosstab_result_id: crosstab.result.result_id, excel_file_id: crosstab.result.excel_file_id })}\n`);
} finally {
  if (project) {
    const cleanup = await fetch(`${base}/api/research/projects/${encodeURIComponent(project.id)}`, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
    process.stdout.write(`cleanup_status=${cleanup.status}\n`);
    if (cleanup.status !== 204) throw new Error(`production wide SAV smoke cleanup failed with ${cleanup.status}`);
  }
}
