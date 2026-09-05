import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-agent-acceptance-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
const decisions = [];

function statuses(options, toolId, failed = false) {
  const labels = { sample_size: "样本量计算", quota_design: "配额设计", questionnaire_check: "问卷质检" };
  decisions.push(toolId);
  options.onToolStatus?.({ tool_id: toolId, label: labels[toolId], status: "running", message: `正在${labels[toolId]}…` });
  options.onToolStatus?.({ tool_id: toolId, label: labels[toolId], status: failed ? "error" : "completed", message: failed ? "专业工具调用未完成" : `已完成${labels[toolId]}` });
}

const harnessAdapter = {
  async createSession() { return "acceptance-session"; },
  async sendMessage(options) {
    const current = String(options.prompt).split("【用户当前要求】").at(-1) || "";
    if (current.includes("95%置信水平、3%误差")) { statuses(options, "sample_size"); return "严格按照确定性工具结果，建议至少 1068 个有效样本。"; }
    if (current.includes("1200样本")) { statuses(options, "quota_design"); return "年龄配额分别为 240、420、360、180。"; }
    if (current.includes("检查当前问卷并直接修改")) { statuses(options, "questionnaire_check"); return "Q1. 您过去 3 个月是否购买？\nA. 是\nB. 否"; }
    if (current.includes("帮我检查当前问卷")) { statuses(options, "questionnaire_check"); return "发现 1 处跳转错误，建议补充目标题。"; }
    if (current.includes("模拟专业工具不可用")) { statuses(options, "sample_size", true); return "样本量计算工具暂时无法使用，因此暂时无法给出确定计算结果。"; }
    if (current.includes("润色")) return "聚焦核心业务决策，识别关键增长机会。";
    if (current.includes("访谈大纲")) return "一、研究开场\n• 使用背景\n- 请介绍最近一次使用经历。";
    return "直接回答。";
  },
};

const project = await store.createProject("owner-a", { client_project_id: "acceptance-project", title: "Acceptance Project" });
const questionnaire = await store.createArtifact(project.id, { type: "questionnaire", title: "消费者问卷", content: "Q1. 是否购买？\nA. 是 → Q3\nB. 否" });
const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: "owner-a", RESEARCH_AI_REQUESTS_PER_MINUTE: "100", HARNESS_MAX_TOOL_CALLS: "3" }, store, harnessAdapter, logger: { log() {}, error() {} } });
const server = http.createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function message(text, extra = {}) {
  const response = await fetch(`${base}/api/research/projects/${project.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, client_request_id: `request-${Math.random()}`, ...extra }) });
  assert.equal(response.status, 200);
  return response.json();
}

try {
  let before = decisions.length;
  let result = await message("95%置信水平、3%误差需要多少样本？");
  assert.deepEqual(decisions.slice(before), ["sample_size"], "Test 1: sample size request calls sample_size");
  assert.match(result.reply, /1068/);

  before = decisions.length;
  result = await message("帮我润色这个研究目标。");
  assert.deepEqual(decisions.slice(before), [], "Test 2: polishing does not call tools");

  before = decisions.length;
  result = await message("1200样本，年龄按照20%/35%/30%/15%分配。");
  assert.deepEqual(decisions.slice(before), ["quota_design"], "Test 3: quota request calls quota_design");

  before = decisions.length;
  result = await message("帮我检查当前问卷。", { artifact_id: questionnaire.id, task_type: "artifact_revision" });
  assert.deepEqual(decisions.slice(before), ["questionnaire_check"], "Test 4: current questionnaire calls questionnaire_check");
  assert.equal(result.artifact_created, undefined);

  before = decisions.length;
  result = await message("检查当前问卷并直接修改。", { artifact_id: questionnaire.id, task_type: "artifact_revision" });
  assert.deepEqual(decisions.slice(before), ["questionnaire_check"], "Test 5: check and modify calls questionnaire_check");
  assert.equal(result.artifact_created.parent_artifact_id, questionnaire.id);
  assert.equal(result.artifact_created.version, 2);

  before = decisions.length;
  result = await message("给我设计一个访谈大纲。", { task_type: "interview_guide" });
  assert.deepEqual(decisions.slice(before), [], "Test 6: interview guide does not call research calculation tools");

  before = decisions.length;
  result = await message("模拟专业工具不可用，请计算样本量。");
  assert.deepEqual(decisions.slice(before), ["sample_size"], "Test 7: unavailable gateway produces one bounded tool attempt in the Harness turn");
  assert.match(result.reply, /暂时无法.*确定计算结果/);
  assert.doesNotMatch(result.reply, /\b10(?:67|68)\b/, "failed tools must not fabricate a result");

  console.log("agent-tool-acceptance-smoke: PASS (7/7)");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
