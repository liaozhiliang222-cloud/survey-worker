import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readSseResponse } from "../src/modules/ai-researcher/stream.mjs";

const base = String(process.env.SURVEYKIT_BASE_URL || "https://surveykit.cc").replace(/\/+$/, "");

async function request(path, options = {}, timeoutMs = 30_000) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (!response.ok) throw new Error(`${path} status=${response.status} body=${text.slice(0, 1_000)}`);
  return { status: response.status, payload };
}

async function streamRequest(path, body, timeoutMs = 330_000) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} status=${response.status} body=${text.slice(0, 1_000)}`);
  }
  if (!String(response.headers.get("Content-Type") || "").toLowerCase().includes("text/event-stream")) {
    return { status: response.status, payload: await response.json(), events: [] };
  }
  const streamed = await readSseResponse(response);
  return { status: response.status, payload: streamed.result, events: streamed.events };
}

const interviews = [
  {
    name: "deployment-interview-consumer-a.txt",
    content: [
      "主持人：你对最近一次购物体验最不满意的是什么？",
      "受访者A：我最不满意的是售后响应太慢，每次都要等三天。",
      "主持人：价格方面呢？",
      "受访者A：价格可以接受，但进度不透明让我焦虑。",
    ].join("\n"),
  },
  {
    name: "deployment-interview-consumer-b.txt",
    content: [
      "主持人：最近一次购物有什么痛点？",
      "受访者B：客服回复很快，但是退款什么时候到账完全看不到。",
      "主持人：最希望改进什么？",
      "受访者B：我希望每一步都有明确通知，不要让我反复追问。",
    ].join("\n"),
  },
];

let project = null;
try {
  const tag = crypto.randomUUID();
  let response = await request("/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Qualitative production smoke ${tag.slice(0, 8)}`,
      client_project_id: `deploy-qualitative-smoke-${tag}`,
    }),
  });
  project = response.payload.project;
  const projectPath = `/api/research/projects/${encodeURIComponent(project.id)}`;
  const uploaded = [];

  for (const interview of interviews) {
    response = await request(`${projectPath}/files`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Research-File-Name": encodeURIComponent(interview.name),
        "X-Research-File-Category": "interview",
      },
      body: Buffer.from(interview.content, "utf8"),
    });
    assert.equal(response.status, 201);
    uploaded.push(response.payload.file);
  }

  let files = [];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    files = (await request(`${projectPath}/files`)).payload.files;
    const selected = uploaded.map((item) => files.find((file) => file.id === item.id));
    if (selected.every((file) => file?.parse_status === "completed")) break;
    const failed = selected.find((file) => file?.parse_status === "failed");
    if (failed) throw new Error(`interview parsing failed: ${failed.file_name} ${failed.parse_note || ""}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(uploaded.every((item) => files.find((file) => file.id === item.id)?.parse_status === "completed"), "interview parsing timed out");

  const transcripts = (await request(`${projectPath}/transcripts`)).payload.transcripts;
  assert.equal(transcripts.length, 2);
  assert.ok(transcripts.every((item) => item.status === "ready" && item.segment_count > 0));

  for (const transcript of transcripts) {
    const summary = await streamRequest(`${projectPath}/transcripts/${encodeURIComponent(transcript.id)}/summary`, { force: false }, 210_000);
    assert.equal(summary.status, 200);
    assert.equal(summary.payload?.transcript?.summary_status, "ready");
    assert.ok(summary.payload?.transcript?.deep_summary?.length >= 200, "deep transcript summary is too short");
    assert.equal(summary.payload?.transcript?.summary_source_fingerprint, summary.payload?.transcript?.source_fingerprint);
  }

  response = await streamRequest(`${projectPath}/messages`, {
      message: "请运行正式多访谈定性分析，回答两位受访者对售后体验的共识与差异。必须先调用 transcript_search，再调用 transcript_read 回查上下文；至少保留一条可逐字校验的直接原声，并说明证据边界。",
      task_type: "qualitative_analysis",
      selected_file_ids: uploaded.map((item) => item.id),
      auto_retrieve: false,
      client_request_id: `qualitative-analysis-${tag}`,
  }, 330_000);
  assert.equal(response.status, 200);

  const result = response.payload;
  const completedTools = new Set((result.tool_calls || []).filter((item) => item.status === "completed").map((item) => item.tool_id));
  assert.ok(completedTools.has("transcript_search"), "Harness did not complete transcript_search");
  assert.ok(completedTools.has("transcript_read"), "Harness did not complete transcript_read");
  assert.equal(result.applied_context?.raw_transcript_chars_in_prompt, 0);
  assert.equal(result.applied_context?.transcript_deep_summary_ready_count, 2);
  assert.equal(result.applied_context?.transcript_deep_summary_fallback_count, 0);
  assert.equal(result.workflow?.status, "completed");
  assert.equal(result.workflow?.task_type, "qualitative_analysis");
  assert.equal(result.artifact_created?.type, "qualitative_analysis");
  assert.ok((result.evidence || []).length > 0, "no validated quote evidence returned");
  assert.ok(result.quality?.verified_quote_count > 0, "no quote passed exact Segment validation");

  const artifacts = (await request(`${projectPath}/artifacts`)).payload.artifacts;
  assert.ok(artifacts.some((item) => item.id === result.artifact_created.id));
  const workflows = (await request(`${projectPath}/workflows`)).payload.workflows;
  const persistedWorkflow = workflows.find((item) => item.id === result.workflow.id);
  assert.equal(persistedWorkflow?.status, "completed");
  assert.equal(persistedWorkflow?.constraints?.raw_transcript_chars_in_prompt, 0);
  const evidence = (await request(`${projectPath}/evidence`)).payload.evidence;
  assert.ok(evidence.length > 0);

  const toolResults = (await request(`/api/tools/results?project_id=${encodeURIComponent(project.id)}`)).payload.data.results;
  assert.ok(toolResults.some((item) => item.tool_id === "transcript-search" && item.source === "agent"));
  assert.ok(toolResults.some((item) => item.tool_id === "transcript-read" && item.source === "agent"));

  console.log("production_qualitative_smoke=PASS");
  console.log("transcript_index=PASS");
  console.log("deep_transcript_summary_cache=PASS");
  console.log("harness_transcript_search_and_read=PASS");
  console.log("artifact_workflow_evidence=PASS");
  console.log("raw_transcript_chars_in_prompt=0");
} finally {
  if (project) {
    const cleanup = await fetch(`${base}/api/research/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`cleanup_status=${cleanup.status}`);
    if (cleanup.status !== 204) throw new Error(`production qualitative smoke cleanup failed with ${cleanup.status}`);
  }
}
