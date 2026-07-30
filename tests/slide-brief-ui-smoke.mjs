import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const backend = fs.readFileSync(path.join(root, "deploy", "aliyun_api.py"), "utf8");

for (const field of ["slide_type", "layout_family", "slide_locked"]) {
  assert.match(app, new RegExp(`data-field="${field}"`));
}
assert.doesNotMatch(app, /data-field="slide_claim"/);
assert.doesNotMatch(app, /data-field="insight_bullets"/);
for (const mapping of [
  '["segment_comparison", "人群对比"]',
  '["key_finding", "核心发现"]',
  '["key_finding_with_evidence", "核心发现＋证据"]',
  '["comparison_40_60", "左右对比（40/60）"]',
]) {
  assert.ok(app.includes(mapping), `Missing localized option: ${mapping}`);
}
assert.match(html, /id="pptxContinueEditBtn"/);
assert.match(app, /user_modified/);
assert.match(app, /mergeSlideBriefSuggestion/);
assert.match(app, /persistSlideOrder/);
assert.match(app, /deleteSlideBriefRemote/);
assert.match(app, /data-pptx-action="regenerate-slide"/);
assert.match(app, /async function regenerateSinglePptxSlide/);
assert.match(app, /force_user_modified: forceUserModified/);
assert.match(app, /brief.locked/);
assert.match(app, /window.confirm/);

const confirmStart = app.indexOf("async function confirmReportNarrativeAndGenerate()");
const generateStart = app.indexOf("async function doGeneratePptx()", confirmStart);
assert.ok(confirmStart >= 0 && generateStart > confirmStart);
const confirmFlow = app.slice(confirmStart, generateStart);
assert.doesNotMatch(confirmFlow, /await doGeneratePptx/);
assert.match(confirmFlow, /persistSlideBriefBlueprint/);
assert.ok(confirmFlow.indexOf("confirmNarrativeDimensionSelections()") < confirmFlow.indexOf("generatePptxSlideBriefs(pendingReportNarrative)"));
assert.doesNotMatch(confirmFlow, /页面顺序发生变化/);
assert.match(confirmFlow, /章节与页面顺序已重组/);
assert.match(confirmFlow, /narrativePanel\.style\.display = "none"/);
const batchStart = app.indexOf("async function generatePptxSlideBriefs(reportNarrative, options = {})");
const singleStart = app.indexOf("async function regenerateSinglePptxSlide", batchStart);
assert.ok(batchStart >= 0 && singleStart > batchStart);
const batchFlow = app.slice(batchStart, singleStart);
assert.match(batchFlow, /filterWritablePages/);
assert.match(batchFlow, /organizePagesByNarrative/);
assert.match(batchFlow, /template_structure_reused = false/);
assert.match(batchFlow, /chunkPagesByChapter/);
assert.match(batchFlow, /mapWithConcurrency/);
assert.match(batchFlow, /SLIDE_BRIEF_CONCURRENCY/);
assert.match(batchFlow, /maxTokens: 5000/);
assert.match(batchFlow, /SLIDE_BRIEF_TIMEOUT_MS/);
assert.match(batchFlow, /SLIDE_BRIEF_REPAIR_TIMEOUT_MS/);
assert.match(batchFlow, /chunkRepairPages/);
assert.match(batchFlow, /const initialResults = await/);
assert.match(batchFlow, /const repairResults = await/);
assert.match(batchFlow, /noEvidencePages/);
assert.match(batchFlow, /failure_reason_counts/);
assert.match(batchFlow, /initial_seconds/);
assert.match(batchFlow, /repair_seconds/);
assert.match(batchFlow, /repair_instruction/);
assert.match(batchFlow, /lastPptxSlideBriefStats/);
assert.doesNotMatch(batchFlow, /content: String\(output\)\.slice/);
assert.doesNotMatch(batchFlow, /stream: true/);
assert.match(batchFlow, /requireSlideId: true/);
assert.doesNotMatch(batchFlow, /if \(!generated\.length && writablePages\.length\)/);
assert.ok(batchFlow.indexOf("applyNarrativePageOrder") >= 0);

const generateFlow = app.slice(generateStart, app.indexOf("cancelJobBtn", generateStart));
assert.ok(generateFlow.indexOf("persistSlideBriefBlueprint") < generateFlow.indexOf("selectedFile.arrayBuffer"));

for (const route of [
  "/api/report/{report_id}/slide-briefs",
  "/api/report/{report_id}/slide/{slide_id}",
  "/api/report/{report_id}/slides/reorder",
  "/api/report/{report_id}/slide/{slide_id}/regenerate",
]) {
  assert.ok(backend.includes(route));
}
assert.match(html, /快速报告（快速、稳定）/);
assert.match(html, /AI 研究报告（故事线驱动）/);
assert.match(app, /function selectedPptxReportWorkflow\(\)/);
assert.match(app, /生成核心观点与报告蓝图/);
assert.doesNotMatch(app, /enrichPptxPlanWithAi|parseAiPptxPlanOutput|本地结构已生成/);
const previewFlowStart = app.indexOf('previewBtn && previewBtn.addEventListener("click"');
const previewFlowEnd = app.indexOf("function getPptxQuestionCatalog", previewFlowStart);
assert.ok(previewFlowStart >= 0 && previewFlowEnd > previewFlowStart);
const previewFlow = app.slice(previewFlowStart, previewFlowEnd);
assert.match(previewFlow, /pagePlan\.page_planning_mode = "rule"/);
assert.match(previewFlow, /await generatePptxAiReport\(\)/);
assert.match(app, /function normalizePptxWorkflow\(plan, preferredWorkflow = ""\)/);
assert.match(app, /report_workflow: editedPagePlan\?\.report_workflow/);
assert.match(app, /page_planning_mode: editedPagePlan\?\.page_planning_mode/);
assert.match(app, /ai_enhancement: editedPagePlan\?\.ai_enhancement/);
assert.doesNotMatch(app, /planning_mode\s*=\s*"ai_report"/);
assert.match(app, /const hasNarrativeBlueprint = isResearch && plan\?\.ai_enhancement === "narrative"/);
assert.match(app, /hasNarrativeBlueprint \? "确认蓝图并生成 PPT"/);
assert.match(app, /isResearch && !hasNarrativeBlueprint/);
assert.match(app, /const chapterGroups = \[\]/);
assert.match(app, /报告目录（按实际顺序）/);
assert.match(app, /PPT 第 \$\{outputProjection\.contentSlideNumbers\[idx\]\} 页/);
assert.match(app, /qa\.slide_count/);

const projectionStart = app.indexOf("function getPptxOutputPageProjection");
const projectionEnd = app.indexOf("function setPptxCancelState", projectionStart);
assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
const projectionContext = vm.createContext({ result: null, plan: {
  pages: [{ chapter: "A" }, { chapter: "B" }, { chapter: "A" }],
  global_findings: [{ title: "finding" }],
  data_facts: [{ fact_type: "segment_gap", value: 12 }],
  appendix: { count: 2 },
} });
vm.runInContext(app.slice(projectionStart, projectionEnd) + "; result = getPptxOutputPageProjection(plan);", projectionContext);
assert.equal(projectionContext.result.analysisPages, 3);
assert.equal(projectionContext.result.sectionPages, 3);
assert.equal(projectionContext.result.fixedSystemPages, 8);
assert.equal(projectionContext.result.totalPages, 14);
assert.deepEqual(Array.from(projectionContext.result.contentSlideNumbers), [7, 9, 11]);

const quickStart = app.indexOf("async function generatePptxQuickAiReport()");
const workflowDispatchStart = app.indexOf("function runSelectedPptxAiWorkflow()", quickStart);
assert.ok(quickStart >= 0 && workflowDispatchStart > quickStart);
const quickFlow = app.slice(quickStart, workflowDispatchStart);
assert.match(quickFlow, /index \+= 10/);
assert.match(quickFlow, /Promise\.all/);
assert.match(quickFlow, /Math\.min\(2/);
assert.match(quickFlow, /brief\.locked \|\| brief\.user_modified/);
assert.match(quickFlow, /report_workflow = "quick"/);
assert.match(quickFlow, /ai_enhancement = "copy"/);
assert.match(quickFlow, /setPptxProgress/);
assert.match(quickFlow, /await doGeneratePptx\(\)/);
assert.doesNotMatch(quickFlow, /REPORT_NARRATIVE_SYSTEM_PROMPT/);
assert.match(quickFlow, /每页最多引用2个数字/);
assert.match(quickFlow, /business_implication: page\.business_implication/);
assert.match(quickFlow, /requireSlideId: true/);
assert.match(quickFlow, /Quick report batch/);
assert.match(quickFlow, /failedPageCount/);
assert.doesNotMatch(quickFlow, /fallbackEvidence/);
assert.doesNotMatch(quickFlow, /stream: true/);
assert.match(quickFlow, /evidence_fact_ids/);
assert.match(quickFlow, /await doGeneratePptx\(\)/);
assert.match(app, /判断\/解释\/行动约70%/);
assert.match(app, /禁止白描式复述/);
assert.match(app, /function evidenceNumericValues/);
assert.match(app, /sampleClaims/);
assert.match(app, /unitClaims/);
assert.match(app, /coefficientClaims/);
assert.match(app, /evidenceLabelMatchesClause/);
assert.match(quickFlow, /子样本题和特定车型题/);

const workflowDispatch = app.slice(workflowDispatchStart, app.indexOf("async function generatePptxAiReport()", workflowDispatchStart));
assert.match(workflowDispatch, /report_workflow === "research"/);
assert.match(workflowDispatch, /generatePptxAiReport\(\)/);
assert.match(workflowDispatch, /generatePptxQuickAiReport\(\)/);
assert.match(app, /function availableNarrativeDimensions/);
assert.match(app, /function updateNarrativeChapterDimensions/);
assert.match(app, /function confirmNarrativeDimensionSelections/);
assert.match(app, /data-narrative-dimension/);
assert.match(app, /page_dimension_plan: \[\]/);
assert.match(app, /dimension_selection_confirmed: true/);
assert.match(html, /确认分析维度并生成蓝图/);
assert.match(html, /AI 已为每章推荐分析维度/);
assert.match(app, /label: "仅看总体"/);
assert.match(app, /总体不占维度名额/);
assert.match(app, /最多选择 2 个细分维度/);
const dimensionListenerStart = app.indexOf('narrativeContent?.addEventListener("change"');
const dimensionListenerEnd = app.indexOf('narrativeConfirmBtn?.addEventListener', dimensionListenerStart);
assert.ok(dimensionListenerStart >= 0 && dimensionListenerEnd > dimensionListenerStart);
const dimensionListener = app.slice(dimensionListenerStart, dimensionListenerEnd);
assert.match(dimensionListener, /comparisonInputs.length > 2/);
assert.doesNotMatch(dimensionListener, /callAiChatCompletion|generatePptxSlideBriefs/);
assert.match(app, /function applyNarrativeDimensionStrategy/);
assert.match(app, /markPptxDimensionCopyStale/);
assert.match(app, /schedulePptxDimensionCopySync/);
assert.match(app, /runPendingPptxDimensionCopySync/);
assert.match(app, /dimensionCopySyncRunning/);
assert.match(app, /文字待同步/);
assert.match(app, /锁定页面不能修改分析维度/);
assert.match(app, /targetSlideIds/);
assert.ok(batchFlow.indexOf("applyNarrativeDimensionStrategy") < batchFlow.indexOf("requestPptxInsightContext"));
assert.match(app, /available_dimensions: editedPagePlan\.available_dimensions/);
assert.match(app, /evidence_signature/);
assert.match(app, /分析维度对应的AI文字仍在同步/);
console.log("slide brief UI/API smoke: ok");
