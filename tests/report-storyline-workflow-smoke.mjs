import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildEvidenceIndex,
  buildReportStorylinePrompt,
  deduplicateInsights,
  detectEvidenceConflicts,
  evaluateReportOutline,
  finalizeReportStoryline,
  inferEvidenceStrength,
  normalizeReportOutline,
  reportStorylineWorkflowStages,
} from "../lib/report-storyline.mjs";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");

function ev(id, type, claim, extras = {}) {
  return { id, project_id: "p1", type, claim, source_type: type === "quantitative" ? "crosstab" : type === "transcript_quote" ? "transcript_segment" : type === "tool_result" ? "tool_result" : "artifact", source_id: `${id}_source`, value: JSON.stringify(extras.value || {}), strength: extras.strength, theme: extras.theme || "", excluded: extras.excluded || false, created_at: extras.created_at || "2026-09-03T00:00:00.000Z", updated_at: extras.updated_at || "2026-09-03T00:00:00.000Z" };
}

const evidence = [
  ev("q_youth_nps", "quantitative", "18-24岁用户NPS为18，显著低于总体31", { theme: "年轻用户NPS", value: { metric: "NPS", value: 18, total: 31, significant: true, segment: "18-24岁" } }),
  ev("quote_youth_brand", "transcript_quote", "年轻用户认为品牌传播与自身距离较远", { theme: "年轻用户NPS", strength: "weak", value: { quote: "这些内容不像给我们看的", transcript_title: "年轻用户访谈", respondent_label: "年轻用户A", segment: "18-24岁" } }),
  ev("q_live_high", "quantitative", "直播用户整体满意度较高", { theme: "直播体验", value: { value: 78, segment: "直播用户", polarity: "positive" } }),
  ev("quote_live_long", "transcript_quote", "部分年轻用户认为直播内容冗长", { theme: "直播体验", value: { quote: "太长了", segment: "年轻用户", polarity: "negative" } }),
  ev("quote_heavy_live", "transcript_quote", "少数重度直播用户把直播视为核心决策渠道", { theme: "直播价值", value: { quote: "我基本都在直播间做决定", segment: "重度直播用户", boundary: "关键少数", polarity: "positive" } }),
  ev("q_service_gap", "quantitative", "年轻用户服务满意度显著低于总体", { theme: "服务体验", value: { significant: true, segment: "18-24岁" } }),
  ev("q_value_gap", "quantitative", "年轻用户价值感知显著低于总体", { theme: "价值感知", value: { significant: true, segment: "18-24岁" } }),
  ev("expert_membership", "qualitative", "专家指出竞品会员运营采用1+N模式", { theme: "竞品会员运营", strength: "weak", value: { segment: "专家访谈" } }),
  ev("excluded_old", "artifact", "一条已过时的专家判断", { excluded: true, theme: "过时信息" }),
];

// Test 1：定量 + 定性互证。
let outline = normalizeReportOutline({
  title: "年轻用户体验诊断报告大纲",
  report_goal: "识别NPS拖累来源并支持改善决策",
  storyline_type: "diagnosis",
  core_insights: [
    { id: "i1", title: "年轻用户已成为NPS的核心拖累群体", statement: "年轻用户已成为NPS的核心拖累群体", evidence_ids: ["q_youth_nps", "quote_youth_brand"] },
    { id: "i2", title: "服务体验是年轻用户短板之一", statement: "服务体验是年轻用户短板之一", evidence_ids: ["q_service_gap"] },
    { id: "i3", title: "价值感知短板进一步削弱推荐意愿", statement: "价值感知短板进一步削弱推荐意愿", evidence_ids: ["q_value_gap"] },
  ],
  storyline: [{ section_id: "s1", section_title: "问题诊断", section_purpose: "定位结构性短板", core_message: "问题集中在年轻用户", supporting_insight_ids: ["i1", "i2", "i3"], evidence_ids: ["q_youth_nps"], transition: "从人群定位进入原因拆解" }],
  chapters: [{ chapter_no: 1, title: "年轻用户成为主要拖累", core_message: "年轻用户是首要改善对象", pages: [{ page_no: 1, page_title: "年轻用户分析", key_message: "18-24岁用户已成为NPS的核心拖累群体", evidence_ids: ["q_youth_nps", "quote_youth_brand"], suggested_visual: "分年龄NPS柱状图 + 年轻用户原声" }] }],
}, { validEvidence: evidence, projectTitle: "荣耀电商NPS" });
assert.equal(outline.core_insights[0].evidence_coverage.quantitative, true);
assert.equal(outline.core_insights[0].evidence_coverage.qualitative, true);
assert.equal(outline.core_insights[0].confidence, "high");

// Test 2：只有定性 Evidence 也允许形成 Insight，并如实标注类型与强度。
const qualOnly = normalizeReportOutline({ core_insights: [{ title: "竞品会员运营正在形成体系化优势", statement: "竞品会员运营正在形成体系化优势", evidence_ids: ["expert_membership"] }], chapters: [{ title: "竞品启示", pages: [{ key_message: "竞品会员运营采用1+N模式", evidence_ids: ["expert_membership"] }] }] }, { validEvidence: evidence });
assert.equal(qualOnly.core_insights[0].evidence_coverage.qualitative, true);
assert.equal(qualOnly.core_insights[0].evidence_coverage.quantitative, false);
assert.equal(qualOnly.core_insights[0].confidence, "medium");
assert.equal(inferEvidenceStrength(evidence.at(-2)), "weak");

// Test 3 + Test 4：方向冲突被识别；不同人群的反例保留为边界而非删除。
const conflicts = detectEvidenceConflicts(evidence);
const liveConflict = conflicts.find((item) => item.theme.includes("直播体验"));
assert.ok(liveConflict);
assert.equal(liveConflict.status, "segmented");
assert.match(liveConflict.explanation, /不同人群|边界条件/);
assert.ok(evidence.some((item) => item.id === "quote_heavy_live"));

// Test 5：重复 Insight 合并并保留 Evidence 并集。
const deduped = deduplicateInsights([
  { id: "d1", title: "年轻用户品牌感知偏弱", statement: "年轻用户的品牌感知偏弱", evidence_ids: ["q_youth_nps"] },
  { id: "d2", title: "年轻用户品牌认知较弱", statement: "年轻用户品牌认知较弱", evidence_ids: ["quote_youth_brand"] },
]);
assert.equal(deduped.length, 1);
assert.deepEqual(new Set(deduped[0].evidence_ids), new Set(["q_youth_nps", "quote_youth_brand"]));

// Test 6：无法支持的结论形成 Evidence Gap，不伪造引用。
const gapOutline = normalizeReportOutline({ core_insights: [{ title: "主播能力是满意度下降的唯一原因", statement: "主播能力是满意度下降的唯一原因", evidence_ids: ["not_in_project"] }], chapters: [{ title: "原因", pages: [{ key_message: "主播能力是唯一原因", evidence_ids: [] }] }] }, { validEvidence: evidence });
assert.equal(gapOutline.core_insights[0].status, "needs_evidence");
assert.ok(gapOutline.evidence_gaps.length >= 1);
assert.equal(gapOutline.core_insights[0].evidence_ids.length, 0);

// Test 7：Storyline 围绕研究问题，不按研究方法堆叠。
assert.deepEqual(outline.storyline.map((item) => item.section_title), ["问题诊断"]);
assert.ok(!outline.storyline.some((item) => /^(定量分析|定性分析|访谈)$/.test(item.section_title)));

// Test 8：主题标签会被改成结论标题。
assert.equal(outline.chapters[0].pages[0].page_title, "18-24岁用户已成为NPS的核心拖累群体");

// Test 9 + Test 12：结构修订只带 Outline / Evidence Index，显式声明不重跑底层材料。
const index = buildEvidenceIndex({ evidence, insights: outline.core_insights, artifacts: [{ id: "a1", type: "analysis", title: "定量分析", version: 1, content: "年轻用户差异摘要" }], maxChars: 30_000 });
assert.doesNotThrow(() => JSON.parse(index.serialized));
const revisionPrompt = buildReportStorylinePrompt({ project: { title: "荣耀电商NPS", research_goal: "改善年轻用户NPS" }, message: "行业趋势提前，把第3章和第4章对调", evidenceIndex: index, currentOutline: { id: "outline-v1", type: "report_outline", version: 1, content: JSON.stringify(outline) } });
assert.equal(revisionPrompt.context.report_outline_revision, true);
assert.equal(revisionPrompt.context.raw_transcript_chars_in_prompt, 0);
assert.equal(revisionPrompt.context.raw_dataset_rows_in_prompt, 0);
assert.deepEqual(revisionPrompt.context.selected_files, []);
assert.deepEqual(revisionPrompt.context.retrieved_chunks, []);
assert.match(revisionPrompt.prompt, /不得重新运行定量分析、定性分析、逐字稿检索或数据工具/);
assert.doesNotMatch(revisionPrompt.prompt, /我基本都在直播间做决定/); // Index 仅保留证据 claim，不注入完整逐字稿。
assert.ok(revisionPrompt.prompt.length <= 60_000);

// Test 10 + Test 11：V1 → V2 不覆盖；5 条核心结论均可回到当前 Project Evidence。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-report-storyline-"));
try {
  const store = new JsonResearchStore(path.join(tmp, "research.json"));
  const project = await store.createProject("user-1", { client_project_id: "p1", title: "荣耀电商NPS", research_goal: "诊断推荐意愿" });
  for (const item of evidence.filter((entry) => !entry.excluded)) await store.createEvidence(project.id, { id: item.id, type: item.type, claim: item.claim, value: JSON.parse(item.value), source_type: item.source_type, source_id: item.source_id, strength: item.strength, theme: item.theme });
  const raw = {
    title: "荣耀电商NPS报告大纲",
    storyline_type: "diagnosis",
    rationale: "先定位人群，再解释原因，最后提出机会。",
    core_insights: [
      { title: "年轻用户已成为NPS的核心拖累群体", statement: "年轻用户NPS显著偏低", evidence_ids: ["q_youth_nps", "quote_youth_brand"] },
      { title: "直播总体满意但年轻用户仍感到内容冗长", statement: "直播价值存在人群分化", evidence_ids: ["q_live_high", "quote_live_long"] },
      { title: "服务体验是年轻用户短板之一", statement: "服务满意度偏低", evidence_ids: ["q_service_gap"] },
      { title: "价值感知短板进一步削弱推荐意愿", statement: "价值感知偏低", evidence_ids: ["q_value_gap"] },
      { title: "竞品会员运营已从单点能力转向体系化经营", statement: "竞品采用1+N模式", evidence_ids: ["expert_membership"] },
    ],
    evidence_conflicts: [{ theme: "直播体验", evidence_ids: ["q_live_high", "quote_live_long"], status: "segmented", explanation: "总体与年轻细分存在差异" }],
    storyline: [{ section_id: "s1", section_title: "核心问题与成因", section_purpose: "解释NPS结构性拖累", core_message: "年轻用户是主线", supporting_insight_ids: [], evidence_ids: ["q_youth_nps"], transition: "由问题进入机会" }],
    chapters: [{ chapter_no: 1, title: "核心问题与成因", core_message: "年轻用户形成主要拖累", pages: [
      { page_no: 1, page_title: "年轻用户成为主要拖累", key_message: "年轻用户已成为NPS的核心拖累群体", evidence_ids: ["q_youth_nps", "quote_youth_brand"] },
      { page_no: 2, page_title: "直播价值存在人群分化", key_message: "总体满意不等于所有细分满意", evidence_ids: ["q_live_high", "quote_live_long"] },
      { page_no: 3, page_title: "服务满意度偏低", key_message: "服务体验是年轻用户短板之一", evidence_ids: ["q_service_gap"] },
      { page_no: 4, page_title: "价值感知偏低", key_message: "价值感知短板削弱推荐意愿", evidence_ids: ["q_value_gap"] },
      { page_no: 5, page_title: "竞品会员运营体系化", key_message: "竞品采用1+N会员运营模式", evidence_ids: ["expert_membership"] },
    ] }],
  };
  const storedEvidence = await store.listEvidence(project.id);
  const first = await finalizeReportStoryline({ store, projectId: project.id, projectTitle: project.title, reply: JSON.stringify(raw), evidence: storedEvidence });
  const firstOutline = JSON.parse(first.artifact.content);
  assert.equal(first.artifact.version, 1);
  assert.equal(firstOutline.core_insights.length, 5);
  assert.ok(firstOutline.core_insights.every((item) => item.evidence_ids.length >= 1));
  assert.ok(firstOutline.core_insights.flatMap((item) => item.evidence_ids).every((evidenceId) => storedEvidence.some((item) => item.id === evidenceId)));
  const second = await finalizeReportStoryline({ store, projectId: project.id, projectTitle: project.title, reply: JSON.stringify({ ...raw, rationale: "按客户要求先讲行业趋势，再进入问题。" }), evidence: storedEvidence, existingInsights: await store.listResearchInsights(project.id), parentArtifactId: first.artifact.id, existingOutline: firstOutline });
  assert.equal(second.artifact.version, 2);
  assert.equal(second.artifact.parent_artifact_id, first.artifact.id);
  assert.equal((await store.listArtifacts(project.id)).filter((item) => item.type === "report_outline").length, 2);
  assert.equal(second.outline.revision.structure_only, true);
  assert.equal(evaluateReportOutline(second.outline).traced_core_insight_count, 5);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Handler integration: the real report_storyline task runs as a persisted
// workflow, disables tools/retrieval, and returns a traceable outline artifact.
const handlerTmp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-report-handler-"));
const handlerStore = new JsonResearchStore(path.join(handlerTmp, "research.json"));
const handlerProject = await handlerStore.createProject("owner", { client_project_id: "handler-p1", title: "报告闭环测试", research_goal: "定位年轻用户体验问题" });
await handlerStore.createEvidence(handlerProject.id, { id: "handler-e1", type: "quantitative", claim: "年轻用户NPS显著低于总体", source_type: "crosstab", source_id: "ct-1", strength: "strong", theme: "年轻用户NPS", value: { metric: "NPS", value: 18, total: 31 } });
const foreignProject = await handlerStore.createProject("owner", { client_project_id: "handler-p2", title: "其他项目" });
await handlerStore.createEvidence(foreignProject.id, { id: "foreign-e1", type: "quantitative", claim: "其他项目证据", source_type: "crosstab", source_id: "ct-foreign", strength: "strong" });
const handlerCalls = [];
const handlerHarness = {
  async createSession() { return "report-storyline-session"; },
  async sendMessage(options) {
    handlerCalls.push(options);
    return JSON.stringify({
      title: "年轻用户NPS诊断报告大纲",
      report_goal: "支持年轻用户体验改善决策",
      storyline_type: "diagnosis",
      rationale: "先定位问题人群，再解释成因。",
      core_insights: [{ title: "年轻用户已成为NPS核心拖累", statement: "年轻用户NPS显著低于总体", evidence_ids: ["handler-e1"] }],
      storyline: [{ section_id: "s1", section_title: "年轻用户问题诊断", section_purpose: "锁定优先改善对象", core_message: "年轻用户是核心拖累", supporting_insight_ids: [], evidence_ids: ["handler-e1"], transition: "进入成因拆解" }],
      chapters: [{ chapter_no: 1, title: "年轻用户成为核心拖累", purpose: "锁定优先人群", core_message: "年轻用户应优先改善", pages: [{ page_no: 1, page_title: "年轻用户NPS显著落后总体", key_message: "年轻用户NPS显著低于总体，应成为优先改善对象", evidence_ids: ["handler-e1"], suggested_visual: "人群NPS对比" }] }],
    });
  },
};
const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: "owner", RESEARCH_AI_REQUESTS_PER_MINUTE: "100" }, store: handlerStore, harnessAdapter: handlerHarness, logger: { log() {}, error() {} } });
const server = http.createServer(handler);
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/research/projects/${handlerProject.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "生成报告大纲", task_type: "report_storyline", client_request_id: `report-${crypto.randomUUID()}`, selected_file_ids: ["stale-ui-selection"] }) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.workflow.task_type, "report_storyline");
  assert.equal(payload.workflow.status, "completed");
  assert.equal(payload.artifact_created.type, "report_outline");
  assert.equal(payload.artifact_created.version, 1);
  assert.deepEqual(payload.tool_calls, []);
  assert.deepEqual(handlerCalls[0].allowedResearchTools, []);
  assert.equal(payload.applied_context.raw_transcript_chars_in_prompt, 0);
  assert.equal(payload.applied_context.raw_dataset_rows_in_prompt, 0);
  assert.doesNotMatch(handlerCalls[0].prompt, /这些内容不像给我们看的|我基本都在直播间做决定/);
  const invalidArtifact = await fetch(`http://127.0.0.1:${server.address().port}/api/research/projects/${handlerProject.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "report_outline", title: "越权大纲", content: JSON.stringify({ core_insights: [{ evidence_ids: ["foreign-e1"] }] }) }) });
  assert.equal(invalidArtifact.status, 400);
  assert.equal((await invalidArtifact.json()).error.type, "invalid_evidence_scope");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(handlerTmp, { recursive: true, force: true });
}

assert.deepEqual(reportStorylineWorkflowStages.map((stage) => stage.id), ["goal", "evidence_index", "candidate_insights", "validation", "core_insights", "storyline", "outline"]);
console.log("report-storyline-workflow-smoke: ok (Test 1-12)");
