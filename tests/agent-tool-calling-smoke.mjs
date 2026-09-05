import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { executeAgentTool, AGENT_TOOL_PERMISSIONS, AGENT_TOOL_REGISTRY } from "../lib/agent-tools/adapter.mjs";
import { syncTranscriptFromFile } from "../lib/qualitative-analysis.mjs";

const require = createRequire(import.meta.url);
const { JsonResearchStore } = require("../lib/research-store.js");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-agent-tools-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
const logs = [];
const logger = { log: (line) => logs.push(JSON.parse(line)), error: (line) => logs.push(JSON.parse(line)) };

try {
  const project = await store.createProject("owner-a", { client_project_id: "agent-project", title: "Agent Project" });
  await store.createProject("owner-b", { client_project_id: "foreign-project", title: "Foreign Project" });
  await store.setSession(project.id, "harness-session-a");

  assert.deepEqual(Object.keys(AGENT_TOOL_REGISTRY), ["sample_size", "quota_design", "questionnaire_check", "data_profile", "data_clean", "data_weight", "crosstab", "transcript_search", "transcript_read"]);
  assert.deepEqual(AGENT_TOOL_PERMISSIONS, { "*": false, sample_size: true, quota_design: true, questionnaire_check: true, data_profile: true, data_clean: true, data_weight: true, crosstab: true, transcript_search: true, transcript_read: true });

  const sample = await executeAgentTool({ agentToolId: "sample_size", args: { confidence_level: 0.95, margin_of_error: 0.03 }, harnessSessionId: "harness-session-a", callId: "call-sample", requestId: "request-sample", store, logger });
  assert.equal(sample.data.recommended_sample, 1068, "result must come from the deterministic SurveyKit sample service");
  assert.equal(sample.data.confidence_level, 0.95);
  assert.equal(sample.saved.source, "agent");
  assert.equal(sample.saved.user_id, "owner-a", "user scope must be injected from the Harness session");
  const replay = await executeAgentTool({ agentToolId: "sample_size", args: { confidence_level: 0.9, margin_of_error: 0.1 }, harnessSessionId: "harness-session-a", callId: "call-sample", requestId: "request-replay", store, logger });
  assert.equal(replay.replayed, true);
  assert.equal(replay.data.result_id, sample.data.result_id, "one Harness call id must save exactly one result");

  const quota = await executeAgentTool({ agentToolId: "quota_design", args: { total_sample: 1200, mode: "single", dimensions: [{ name: "年龄", groups: [{ label: "18-24", share: 20 }, { label: "25-34", share: 35 }, { label: "35-44", share: 30 }, { label: "45+", share: 15 }] }] }, harnessSessionId: "harness-session-a", callId: "call-quota", requestId: "request-quota", store, logger });
  assert.deepEqual(quota.data.dimensions[0].groups.map((group) => group.sample), [240, 420, 360, 180]);

  const questionnaire = await executeAgentTool({ agentToolId: "questionnaire_check", args: { questionnaire_text: "Q1. 您是否购买？\nA. 是 → 跳至 Q3\nB. 否" }, harnessSessionId: "harness-session-a", callId: "call-questionnaire", requestId: "request-questionnaire", store, logger });
  assert.equal(questionnaire.data.summary.errors, 1);
  assert.ok(questionnaire.data.key_issues.length <= 20, "Harness receives a compact issue list");

  const transcript = await syncTranscriptFromFile({ store, projectId: project.id, file: { id: "interview-file", project_id: project.id, file_name: "消费者访谈.txt", category: "interview", parse_status: "completed", parsed_text: "访谈员：为什么购买？\n受访者：产品可靠，售后响应也很快。", updated_at: new Date().toISOString() } });
  const search = await executeAgentTool({ agentToolId: "transcript_search", args: { query: "售后 响应", transcript_ids: [transcript.id] }, harnessSessionId: "harness-session-a", callId: "call-transcript-search", requestId: "request-transcript-search", store, logger });
  assert.equal(search.data.matches.length, 1);
  const read = await executeAgentTool({ agentToolId: "transcript_read", args: { transcript_id: transcript.id, segment_id: search.data.matches[0].segment_id }, harnessSessionId: "harness-session-a", callId: "call-transcript-read", requestId: "request-transcript-read", store, logger });
  assert.ok(read.data.segments.some((item) => item.is_target));

  await assert.rejects(executeAgentTool({ agentToolId: "sample_size", args: {}, harnessSessionId: "unknown", callId: "unknown-call", requestId: "unknown", store, logger }), (error) => error.code === "AGENT_SESSION_NOT_FOUND");
  await assert.rejects(executeAgentTool({ agentToolId: "bash", args: {}, harnessSessionId: "harness-session-a", callId: "blocked", requestId: "blocked", store, logger }), (error) => error.code === "AGENT_TOOL_NOT_ALLOWED");

  const saved = await store.listToolResults(project.id);
  assert.equal(saved.length, 5);
  assert.ok(saved.every((item) => item.source === "agent" && item.user_id === "owner-a"));
  assert.ok(logs.every((item) => !JSON.stringify(item).includes("questionnaire_text") && !JSON.stringify(item).includes("API_KEY")), "logs must not contain arguments or credentials");

  const root = path.resolve(import.meta.dirname, "..");
  const plugin = fs.readFileSync(path.join(root, "deploy/harness/dsh-surveykit-tools/lib/index.js"), "utf8");
  assert.equal((plugin.match(/registerTool\(ctx, \{/g) || []).length, 9);
  assert.doesNotMatch(plugin, /ctx\.tools\.restrict/);
  assert.match(plugin, /exec\.agent\?\.id/);
  assert.match(plugin, /data_profile: 45_000/);
  assert.match(plugin, /crosstab: 90_000/);
  assert.match(plugin, /attempts: 1/);
  assert.match(plugin, /attempts: 2/);
  assert.match(plugin, /field_query/);
  assert.match(plugin, /do_not_estimate: true/);
  assert.doesNotMatch(plugin, /Cookie|user_id|project_id/);
  console.log("agent-tool-calling-smoke: PASS");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
