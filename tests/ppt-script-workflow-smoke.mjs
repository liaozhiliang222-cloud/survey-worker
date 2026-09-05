import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildPptScriptEvidenceContext,
  buildPptScriptPrompt,
  finalizePptScript,
  normalizePptScript,
  pptScriptWorkflowStages,
  validatePptScriptEvidenceScope,
} from "../lib/ppt-script-workflow.mjs";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { JsonResearchStore } = require("../lib/research-store.js");

function evidence(id, type, claim, value, sourceId = `source_${id}`) {
  return { id, project_id: "p1", type, claim, source_type: type === "transcript_quote" ? "transcript_segment" : "crosstab", source_id: sourceId, strength: type === "quantitative" ? "strong" : "medium", theme: "体验", excluded: false, value: JSON.stringify(value) };
}

const projectEvidence = [
  evidence("e_nps", "quantitative", "18-24岁NPS为18，总体为31", { segment: "18-24岁", metric: "NPS", value: 18, total: 31 }, "ct_nps"),
  evidence("e_service", "quantitative", "年轻用户服务满意度为62%，总体为76%", { segment: "18-24岁", value: 62, total: 76, unit: "%" }, "ct_service"),
  evidence("e_value", "quantitative", "年轻用户价值感知为58%，总体为73%", { segment: "18-24岁", value: 58, total: 73, unit: "%" }, "ct_value"),
  evidence("e_live", "quantitative", "直播用户满意度为78%", { segment: "直播用户", value: 78, unit: "%" }, "ct_live"),
  evidence("e_quote", "transcript_quote", "年轻用户认为内容与自己距离较远", { quote: "这些内容不像给我们看的", transcript_title: "年轻用户访谈", respondent_label: "用户A", segment_id: "seg_12" }, "seg_12"),
];

const outlineContent = {
  schema_version: "surveykit.report_outline.v1",
  title: "年轻用户体验诊断报告大纲",
  core_insights: [
    { id: "i1", title: "年轻用户是NPS核心拖累", statement: "18-24岁NPS显著低于总体", evidence_ids: ["e_nps", "e_quote"] },
    { id: "i2", title: "服务体验构成首要短板", statement: "年轻用户服务满意度偏低", evidence_ids: ["e_service"] },
    { id: "i3", title: "价值感知进一步削弱推荐", statement: "年轻用户价值感知偏低", evidence_ids: ["e_value"] },
  ],
  storyline: [{ section_id: "s1", section_title: "问题定位", section_purpose: "锁定人群", core_message: "年轻用户是主线", evidence_ids: ["e_nps"], transition: "进入成因" }],
  chapters: [{ chapter_no: 1, title: "年轻用户体验诊断", pages: [
    { page_no: 1, page_title: "年轻用户分析", key_message: "18-24岁已成为NPS核心拖累群体", evidence_ids: ["e_nps", "e_quote"] },
    { page_no: 2, page_title: "服务体验短板压低年轻用户推荐意愿", key_message: "服务满意度差距是首要短板", evidence_ids: ["e_service"] },
    { page_no: 3, page_title: "价值感知不足进一步放大推荐缺口", key_message: "价值感知是第二个结构性短板", evidence_ids: ["e_value"] },
    { page_no: 4, page_title: "直播体验总体较好但不能替代基础服务", key_message: "直播满意度高并未抵消服务短板", evidence_ids: ["e_live"] },
    { page_no: 5, page_title: "优先修复服务并重建年轻用户价值感知", key_message: "行动应先服务、再价值传播", evidence_ids: ["e_service", "e_value"] },
  ] }],
};
const outlineArtifact = { id: "outline_v1", type: "report_outline", version: 1, content: JSON.stringify(outlineContent) };

function page(id, title, keyMessage, evidenceIds, extras = {}) {
  return {
    id, chapter: "年轻用户体验诊断", page_type: extras.page_type || "data_insight", title, subtitle: extras.subtitle || "",
    purpose: extras.purpose || "解释该发现对项目决策的意义", key_message: keyMessage,
    supporting_points: extras.supporting_points || ["明确问题范围", "说明业务影响"],
    content_structure: extras.content_structure || [{ region: "left", width: "55%", title: "证据", body: keyMessage, items: [] }],
    data_points: extras.data_points || [], quotes: extras.quotes || [],
    visual_spec: extras.visual_spec || { type: "text_summary", description: "结论与证据", evidence_ids: evidenceIds },
    layout_spec: extras.layout_spec || { composition: "55% 证据 + 45% 结论", regions: [] },
    evidence_ids: evidenceIds, source_notes: "仅使用当前项目 Evidence",
    transition_from_previous: extras.transition_from_previous || "承接上一页结论", transition_to_next: extras.transition_to_next || "进入下一层分析",
    finding_refs: extras.finding_refs || [], recommendation_priority: extras.recommendation_priority || "",
  };
}

const rawScript = {
  title: "年轻用户体验诊断 PPT 脚本",
  style_profile: { id: "research_consulting" },
  pages: [
    page("p1", "年轻用户分析", "18-24岁已成为NPS核心拖累群体", ["e_nps", "e_quote"], { data_points: [{ label: "18-24岁", value: "18", unit: "NPS", evidence_id: "e_nps", data_source_id: "ct_nps" }], quotes: [{ text: "这些内容不像给我们看的", evidence_id: "e_quote", source_label: "年轻用户访谈", segment_id: "seg_12" }], visual_spec: { type: "bar_chart", description: "年轻用户与总体NPS对比", evidence_ids: ["e_nps"] } }),
    page("p2", "服务体验短板压低年轻用户推荐意愿", "服务满意度差距是首要短板", ["e_service"], { data_points: [{ label: "年轻用户", value: "62%", evidence_id: "e_service", data_source_id: "ct_service" }], visual_spec: { type: "bar_chart", description: "满意度对比", evidence_ids: ["e_service"] } }),
    page("p3", "价值感知不足进一步放大推荐缺口", "价值感知是第二个结构性短板", ["e_value"], { data_points: [{ label: "年轻用户", value: "58%", evidence_id: "e_value", data_source_id: "ct_value" }], visual_spec: { type: "bar_chart", description: "价值感知对比", evidence_ids: ["e_value"] } }),
    page("p4", "直播体验总体较好但不能替代基础服务", "直播满意度高并未抵消服务短板", ["e_live"], { data_points: [{ label: "直播用户", value: "78%", evidence_id: "e_live", data_source_id: "ct_live" }], visual_spec: { type: "bar_chart", description: "直播满意度", evidence_ids: ["e_live"] } }),
    page("p5", "优先修复服务并重建年轻用户价值感知", "行动应先服务、再价值传播", ["e_service", "e_value"], { page_type: "recommendation", finding_refs: ["p2", "p3"], recommendation_priority: "P0", visual_spec: { type: "process", description: "两阶段行动路径", evidence_ids: ["e_service", "e_value"] } }),
  ],
};

// Test 1：正常 Report Outline 生成完整逐页脚本。
const normalized = normalizePptScript(rawScript, { projectTitle: "年轻用户项目", outlineArtifact, evidence: projectEvidence });
assert.equal(normalized.schema_version, "surveykit.ppt_script.v1");
assert.equal(normalized.pages.length, 5);
for (const item of normalized.pages) for (const key of ["page_number", "chapter", "page_type", "title", "purpose", "key_message", "content_structure", "visual_spec", "layout_spec", "evidence_ids", "source_notes", "transition", "created_at", "updated_at"]) assert.ok(Object.hasOwn(item, key), `missing ${key}`);
assert.equal(normalized.style_profile.id, "research_consulting");

// Test 2：主题标签被结论标题替换。
assert.equal(normalized.pages[0].title, "18-24岁已成为NPS核心拖累群体");
assert.ok(normalized.pages.every((item) => !/(?:分析|情况|介绍|概览)$/.test(item.title)));

// Test 3：至少 5 页均可回溯当前项目 Evidence。
assert.ok(normalized.pages.every((item) => item.evidence_ids.length > 0));
assert.ok(normalized.pages.flatMap((item) => item.evidence_ids).every((id) => projectEvidence.some((entry) => entry.id === id)));

// Test 4：原声必须逐字一致；伪造引语被移除。
assert.equal(normalized.pages[0].quotes[0].text, "这些内容不像给我们看的");
const badQuote = normalizePptScript({ pages: [page("quote_bad", "年轻用户认为内容缺乏相关性", "内容相关性不足", ["e_quote"], { quotes: [{ text: "这完全不是给年轻人看的", evidence_id: "e_quote" }] })] }, { outlineArtifact, evidence: projectEvidence });
assert.equal(badQuote.pages[0].quotes.length, 0);
assert.ok(badQuote.validation_issues.some((item) => item.type === "unverified_quote"));

// Test 5：缺失或虚构图表数据不会被补齐，而会形成 Gap。
const badData = normalizePptScript({ pages: [page("data_bad", "年轻用户满意度仅为99%", "满意度存在巨大缺口", ["e_service"], { data_points: [{ label: "年轻用户", value: "99%", evidence_id: "e_service", data_source_id: "ct_service" }], visual_spec: { type: "bar_chart", description: "满意度", evidence_ids: ["e_service"] } })] }, { outlineArtifact, evidence: projectEvidence });
assert.equal(badData.pages[0].data_points.length, 0);
assert.ok(badData.evidence_gaps.some((item) => /图表缺少/.test(item.reason)));
assert.equal(badData.quality.invalid_data_count, 1);

// Test 6：信息过载页被标注并给出拆页/压缩建议。
const overloaded = normalizePptScript({ pages: [page("dense", "年轻用户体验问题集中在服务与价值感知两条主线且影响推荐意愿", "体验短板存在多重叠加", ["e_service"], { content_structure: Array.from({ length: 6 }, (_, index) => ({ region: `r${index}`, title: `模块${index}`, body: "长内容".repeat(150) })) })] }, { outlineArtifact, evidence: projectEvidence });
assert.equal(overloaded.pages[0].density.status, "overloaded");
assert.match(overloaded.pages[0].density.recommendation, /拆页|压缩/);

// Test 7：高度重复页面自动合并，Evidence 取并集。
const duplicate = normalizePptScript({ pages: [
  page("dup1", "年轻用户服务体验是推荐意愿的核心短板", "年轻用户服务体验是推荐意愿的核心短板", ["e_service"]),
  page("dup2", "年轻用户服务体验是推荐意愿的核心短板", "年轻用户服务体验是推荐意愿的核心短板", ["e_value"]),
] }, { outlineArtifact, evidence: projectEvidence });
assert.equal(duplicate.pages.length, 1);
assert.deepEqual(new Set(duplicate.pages[0].evidence_ids), new Set(["e_service", "e_value"]));
assert.equal(duplicate.quality.duplicate_page_count, 1);

// Test 8：单页视觉修改只替换目标页，其余页面内容与顺序保持。
const visualRevision = normalizePptScript({ id: "p2", visual_spec: { type: "matrix", description: "重要性×满意度矩阵", evidence_ids: ["e_service"] } }, { outlineArtifact, evidence: projectEvidence, existingScript: normalized, targetPageId: "p2" });
assert.equal(visualRevision.pages[1].visual_spec.type, "matrix");
assert.deepEqual(visualRevision.pages.filter((item) => item.id !== "p2"), normalized.pages.filter((item) => item.id !== "p2"));

// Test 9：只改标题时保留目标页 Evidence 与内容。
const titleRevision = normalizePptScript({ id: "p3", title: "价值感知差距使年轻用户推荐意愿持续承压" }, { outlineArtifact, evidence: projectEvidence, existingScript: normalized, targetPageId: "p3" });
assert.equal(titleRevision.pages[2].title, "价值感知差距使年轻用户推荐意愿持续承压");
assert.deepEqual(titleRevision.pages[2].evidence_ids, normalized.pages[2].evidence_ids);
assert.deepEqual(titleRevision.pages[2].content_structure, normalized.pages[2].content_structure);

// Test 10：调整顺序后页码连续，Evidence 关系不丢失。
const reordered = structuredClone(normalized); [reordered.pages[1], reordered.pages[2]] = [reordered.pages[2], reordered.pages[1]]; reordered.pages.forEach((item, index) => { item.page_number = index + 1; });
assert.deepEqual(reordered.pages.map((item) => item.page_number), [1, 2, 3, 4, 5]);
assert.deepEqual(new Set(reordered.pages.flatMap((item) => item.evidence_ids)), new Set(normalized.pages.flatMap((item) => item.evidence_ids)));
assert.equal(validatePptScriptEvidenceScope(reordered, projectEvidence).valid, true);

// Test 11：V2 专用版式字段从模型脚本完整进入持久化合同。
const v2Contract = normalizePptScript({ pages: [
  { ...page("persona_v2", "专业创作者需要可预测的创作工具", "控制权比滤镜数量更重要", ["e_quote"], { page_type: "persona" }), layout_variant: "profile_evidence", density_hint: "high", evidence_label: "典型画像", profile: { name: "林舟", archetype: "专业创作者", attributes: { 年龄: "31岁", 设备: "旗舰手机" }, motto: "效果可以有风格，但过程必须可控" }, traits: ["项目驱动拍摄"], behaviors: ["保留多个版本"] },
  { ...page("needs_v2", "需求从稳定记录升级到表达自我", "底层稳定性支撑高阶价值", ["e_value"], { page_type: "needs_pyramid" }), layout_variant: "evidence_pyramid", levels: [{ title: "拍得到", body: "稳定记录" }, { title: "拍得像", body: "保留氛围" }, { title: "拍出我", body: "表达风格" }], segment_mapping: [{ segment: "记录者", level: "基础" }] },
  { ...page("priority_v2", "恢复能力应优先于玩法扩充", "优先级来自影响与频率", ["e_service"], { page_type: "priority_matrix" }), layout_variant: "impact_frequency", axes: { x: "发生频率", y: "体验影响" }, quadrant_labels: ["高影响低频", "重点投入", "体验维护", "低优先级"], items: [{ label: "失败难恢复", x: 80, y: 90, weight: 50, priority: "high" }] },
  { ...page("fishbone_v2", "恢复链路缺口持续损害信任", "反馈、解释与恢复同时缺位", ["e_service"], { page_type: "problem_reason" }), layout_variant: "fishbone", outcome_label: "反馈、解释与恢复同时缺位", verdict: "优先补齐失败恢复闭环" },
] }, { outlineArtifact, evidence: projectEvidence });
assert.equal(v2Contract.style_profile.id, "qualitative_tech_blue_v2");
assert.equal(v2Contract.pages[0].layout_variant, "profile_evidence");
assert.equal(v2Contract.pages[0].profile.attributes.年龄, "31岁");
assert.deepEqual(v2Contract.pages[0].traits, ["项目驱动拍摄"]);
assert.equal(v2Contract.pages[1].levels[2].title, "拍出我");
assert.equal(v2Contract.pages[2].axes.y, "体验影响");
assert.equal(v2Contract.pages[2].items[0].x, 80);
assert.equal(v2Contract.pages[3].outcome_label, "反馈、解释与恢复同时缺位");

// Test 12：V1 → V2 保留父版本和 Report Outline 来源，不覆盖旧版本。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-ppt-script-"));
try {
  const store = new JsonResearchStore(path.join(tmp, "research.json"));
  const project = await store.createProject("owner", { client_project_id: "ppt-v", title: "PPT Script 版本测试" });
  const storedOutline = await store.createArtifact(project.id, { type: "report_outline", title: "报告大纲", content: JSON.stringify(outlineContent) });
  const first = await finalizePptScript({ store, projectId: project.id, projectTitle: project.title, reply: JSON.stringify(rawScript), outlineArtifact: storedOutline, evidence: projectEvidence });
  const second = await finalizePptScript({ store, projectId: project.id, projectTitle: project.title, reply: JSON.stringify({ id: "p2", title: "服务体验差距是年轻用户推荐意愿的首要阻碍" }), outlineArtifact: storedOutline, evidence: projectEvidence, currentScriptArtifact: first.artifact, targetPageId: "p2" });
  assert.equal(first.artifact.version, 1);
  assert.equal(second.artifact.version, 2);
  assert.equal(second.artifact.parent_artifact_id, first.artifact.id);
  assert.equal(second.script.source_report_outline_id, storedOutline.id);
  assert.equal((await store.listArtifacts(project.id)).filter((item) => item.type === "ppt_script").length, 2);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// Test 12：Prompt 只含大纲/目标页关联 Evidence，不含原始逐字稿、原始数据行或工具。
const context = buildPptScriptEvidenceContext({ outlineArtifact, evidence: [...projectEvidence, evidence("unused", "transcript_quote", "未引用原声", { quote: "不应进入提示词", full_text: "完整逐字稿" })], insights: outlineContent.core_insights });
const prompt = buildPptScriptPrompt({ project: { title: "年轻用户项目", research_goal: "改善NPS" }, message: "生成脚本", outlineArtifact, evidenceContext: context });
assert.equal(prompt.context.raw_transcript_chars_in_prompt, 0);
assert.equal(prompt.context.raw_dataset_rows_in_prompt, 0);
assert.deepEqual(prompt.context.selected_files, []);
assert.deepEqual(prompt.context.retrieved_chunks, []);
assert.doesNotMatch(prompt.prompt, /不应进入提示词|"full_text"|"raw_rows"/);
assert.ok(prompt.context.included_evidence_ids.every((id) => outlineContent.chapters[0].pages.flatMap((item) => item.evidence_ids).includes(id)));
const pageContext = buildPptScriptEvidenceContext({ outlineArtifact, scriptArtifact: { ...outlineArtifact, type: "ppt_script", content: JSON.stringify(normalized) }, targetPageId: "p2", evidence: projectEvidence });
const pagePrompt = buildPptScriptPrompt({ project: { title: "年轻用户项目" }, message: "改为矩阵", outlineArtifact, scriptArtifact: { id: "script1", type: "ppt_script", content: JSON.stringify(normalized) }, evidenceContext: pageContext, targetPageId: "p2" });
assert.equal(pagePrompt.context.mode, "page_revision");
assert.deepEqual(pagePrompt.context.included_evidence_ids, ["e_service"]);
assert.doesNotMatch(pagePrompt.prompt, /这些内容不像给我们看的/);

// 真实本地 Handler 集成：持久化 Workflow/Artifact、禁用工具与资料检索，并拦截跨项目来源。
const handlerTmp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-ppt-handler-"));
const handlerStore = new JsonResearchStore(path.join(handlerTmp, "research.json"));
const handlerProject = await handlerStore.createProject("owner", { client_project_id: "ppt-handler", title: "PPT Script Handler" });
for (const item of projectEvidence) await handlerStore.createEvidence(handlerProject.id, { ...item, value: JSON.parse(item.value) });
const handlerOutline = await handlerStore.createArtifact(handlerProject.id, { type: "report_outline", title: "Handler 大纲", content: JSON.stringify(outlineContent) });
const foreign = await handlerStore.createProject("owner", { client_project_id: "ppt-foreign", title: "其他项目" });
const foreignOutline = await handlerStore.createArtifact(foreign.id, { type: "report_outline", title: "外部大纲", content: JSON.stringify(outlineContent) });
const calls = [];
const handler = createResearchHandler({
  env: { RESEARCH_DEV_USER_ID: "owner", RESEARCH_AI_REQUESTS_PER_MINUTE: "100" },
  store: handlerStore,
  harnessAdapter: { async createSession() { return "ppt-session"; }, async sendMessage(options) { calls.push(options); return JSON.stringify(rawScript); } },
  logger: { log() {}, error() {} },
});
const server = http.createServer(handler);
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/research/projects/${handlerProject.id}`;
  const response = await fetch(`${base}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "生成 PPT Script", task_type: "ppt_script", artifact_id: handlerOutline.id, selected_file_ids: ["ignored-file"], auto_retrieve: true, client_request_id: `ppt-${crypto.randomUUID()}` }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.workflow.task_type, "ppt_script");
  assert.equal(result.artifact_created.type, "ppt_script");
  assert.deepEqual(result.tool_calls, []);
  assert.deepEqual(calls[0].allowedResearchTools, []);
  assert.deepEqual(result.applied_context.selected_files, []);
  assert.deepEqual(result.applied_context.retrieved_chunks, []);
  assert.equal(result.applied_context.raw_transcript_chars_in_prompt, 0);
  const invalid = structuredClone(normalized); invalid.source_report_outline_id = foreignOutline.id;
  const rejected = await fetch(`${base}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ppt_script", title: "跨项目脚本", content: JSON.stringify(invalid) }) });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.type, "invalid_ppt_script_evidence");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(handlerTmp, { recursive: true, force: true });
}

assert.deepEqual(pptScriptWorkflowStages.map((stage) => stage.id), ["outline", "page_planning", "evidence_mapping", "script", "density", "continuity", "artifact"]);
console.log("ppt-script-workflow-smoke: ok (Test 1-13)");
