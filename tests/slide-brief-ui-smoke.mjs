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
assert.match(app, /class="pptx-preview-page-meta"/);
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
assert.match(styles, /grid-template-areas: "toggle drag page output title meta"/);
assert.match(styles, /"toggle drag page output"[\s\S]*"\. \. title title"[\s\S]*"\. \. meta meta"/);
for (const mapping of [
  '["segment_comparison", "人群对比"]',
  '["key_finding", "核心发现"]',
  '["key_finding_with_evidence", "核心发现＋证据"]',
  '["comparison_40_60", "左右对比（40/60）"]',
]) {
  assert.ok(app.includes(mapping), `Missing localized option: ${mapping}`);
}
assert.match(html, /id="pptxContinueEditBtn"/);
assert.match(html, /id="pptxNarrativeFeedbackInput"/);
assert.match(html, /id="pptxNarrativeFeedbackBtn"/);
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
assert.ok(batchFlow.indexOf("applyNarrativeQuestionBlueprint") < batchFlow.indexOf("requestPptxInsightContext"));

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
assert.match(app, /async function generateStagedReportNarrative/);
assert.match(app, /Assign every page to one chapter by the research question it serves/);
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
assert.equal(projectionContext.result.fixedSystemPages, 7);
assert.equal(projectionContext.result.totalPages, 13);
assert.deepEqual(Array.from(projectionContext.result.contentSlideNumbers), [6, 8, 10]);
assert.deepEqual(Array.from(projectionContext.result.systemPageLabels), ["封面", "目录", "执行摘要", "研究概览", "核心结论", "行动建议", "附录"]);

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
assert.match(quickFlow, /正文不得出现百分比/);
assert.match(quickFlow, /taskTier: "fast"/);
assert.match(quickFlow, /business_implication: page\.business_implication/);
assert.match(quickFlow, /requireSlideId: true/);
assert.match(quickFlow, /findDataNarrationIssues/);
assert.match(quickFlow, /Quick report batch/);
assert.match(quickFlow, /failedPageCount/);
assert.doesNotMatch(quickFlow, /fallbackEvidence/);
assert.doesNotMatch(quickFlow, /stream: true/);
assert.match(quickFlow, /evidence_fact_ids/);
assert.match(quickFlow, /await doGeneratePptx\(\)/);
assert.match(app, /判断\/解释\/行动约70%/);
assert.match(app, /禁止白描式复述/);
assert.match(app, /SLIDE_BRIEF_SYSTEM_PROMPT[\s\S]{0,800}taskTier: "fast"/);
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
assert.match(app, /function applyNarrativeQuestionBlueprint/);
assert.match(app, /recomposePagesByNarrative/);
assert.match(app, /narrative_question_blueprint_signature/);
assert.match(app, /AI 计划页面与题目组合/);
assert.match(app, /require_page_blueprint: true/);
assert.match(app, /page_blueprint_local_optimized/);
assert.match(app, /taskTier: "quality"/);
assert.match(app, /taskTier: "fast"/);
assert.match(app, /524\|502\|503\|504\|timeout/);
assert.match(app, /buildReportFrameworkInput/);
assert.match(app, /buildReportNarrativeRevisionInput/);
assert.match(app, /async function reviseReportNarrativeWithFeedback/);
const stagedNarrativeStart = app.indexOf("async function generateStagedReportNarrative");
const narrativeGenerateStart = app.indexOf("async function generatePptxAiReport()", stagedNarrativeStart);
const stagedNarrativeFlow = app.slice(stagedNarrativeStart, narrativeGenerateStart);
const narrativeRevisionStart = app.indexOf("async function reviseReportNarrativeWithFeedback()", narrativeGenerateStart);
const narrativeLimitsFlow = app.slice(narrativeGenerateStart, app.indexOf("function normalizePptxDimensions", narrativeRevisionStart));
assert.ok(stagedNarrativeStart >= 0 && narrativeGenerateStart > stagedNarrativeStart);
assert.match(stagedNarrativeFlow, /maxTokens: 800/);
assert.match(stagedNarrativeFlow, /章节框架阶段失败/);
assert.match(stagedNarrativeFlow, /页面归属第/);
assert.match(stagedNarrativeFlow, /maxTokens: 650/);
assert.match(stagedNarrativeFlow, /index \+= 4/);
assert.match(stagedNarrativeFlow, /Promise\.all\(wave\.map/);
assert.match(stagedNarrativeFlow, /waveStart \+= 2/);
assert.match(stagedNarrativeFlow, /requestAssignmentBatch\(pages\.slice\(0, midpoint\)/);
assert.match(stagedNarrativeFlow, /assignedPages\.size !== compactPages\.length/);
assert.match(stagedNarrativeFlow, /taskTier: "storyline"/);
assert.match(stagedNarrativeFlow, /stream: false/);
assert.match(narrativeLimitsFlow, /maxTokens: 4000/);
assert.match(narrativeLimitsFlow, /timeoutMs: 180000/);
assert.doesNotMatch(narrativeLimitsFlow, /maxTokens: 2600/);assert.match(app, /function getAiProxyUrl/);
assert.match(app, /function fetchAiProxyWithRetry/);
assert.match(app, /new URL\("\/api\/ai"/);
assert.match(app, /cache: "no-store"/);
assert.doesNotMatch(app, /frameworkTooSimilar/);
assert.doesNotMatch(app, /outcome\.local_framework_used = true/);
assert.doesNotMatch(app, /buildFallbackReportNarrative/);
assert.match(app, /taskTier: "structured"/);
assert.match(app, /AI 页面归属不完整/);
assert.match(app, /buildFallbackPageBlueprint/);
assert.match(app, /async function generateNarrativePageBlueprint/);
const localBlueprintStart = app.indexOf("async function generateNarrativePageBlueprint");
const localBlueprintEnd = app.indexOf("async function confirmReportNarrativeAndGenerate", localBlueprintStart);
assert.ok(localBlueprintStart >= 0 && localBlueprintEnd > localBlueprintStart);
assert.doesNotMatch(app.slice(localBlueprintStart, localBlueprintEnd), /callAiChatCompletion|PAGE_BLUEPRINT_SYSTEM_PROMPT/);
assert.match(app, /readAiChatCompletionStream\(response, options\.onProgress, armTimeout\)/);
assert.match(app, /持续返回内容时允许总耗时超过 timeoutMs/);
assert.match(app, /AI 连续.*秒未返回数据/);
assert.match(app, /const blueprintResult = await generateNarrativePageBlueprint/);
assert.match(app, /timeoutMs: 180000/);
assert.match(app, /taskTier: "structured"[\s\S]{0,80}stream: true/);
assert.match(app, /let narrativeWaitTimer = null/);
assert.match(app, /Math\.min\(58, 30 \+ Math\.floor\(elapsedSeconds \/ 4\)\)/);
assert.match(app, /后台正在检测并选择响应更快的 AI 通道/);
assert.match(app, /当前通道响应较慢/);
assert.match(app, /clearInterval\(narrativeWaitTimer\)/);
assert.match(app, /lastAiActualSource = response\.headers\.get\("X-AI-Source"\)/);
assert.match(app, /本次通道：/);
assert.match(app, /blueprintLocalOptimized/);
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
