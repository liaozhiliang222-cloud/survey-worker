import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.ok(html.indexOf("ppt-report-ai.js") < html.indexOf("app.js"), "PPT AI module must load before app.js.");
assert.match(html, /id="pptxNarrativePanel"/);
assert.match(html, /id="pptxNarrativeConfirmBtn"[^>]*>生成蓝图并继续编辑</);
assert.match(html, /id="pptxContinueEditBtn"/);
assert.match(html, /id="pptxNarrativeRegenerateBtn"[^>]*>重新生成故事线</);
const context = vm.createContext({ globalThis: {}, Set, Map, Array, String, Number, JSON, Math });
vm.runInContext(source, context);
const ai = context.globalThis.PptReportAi;
assert.ok(ai, "PptReportAi must be exported.");

const reportContext = {
  source: "survey.xlsx",
  data_facts: [
    { fact_id: "F1", question_id: "Q1" },
    { fact_id: "F2", question_id: "Q2" },
    { fact_id: "F3", question_id: "Q3" },
  ],
  global_findings: [{
    title: "核心用户体验更好",
    description: "年轻用户评价更集中",
    evidence_fact_ids: ["F1"],
    evidence_question_ids: ["Q1"],
    action_implication: "优先经营核心用户",
  }],
  pages: [
    { page_idx: 1, chapter: "用户画像", evidence_fact_ids: ["F1"], questions: [{ code: "Q1" }], slide_brief: { question_answered: "用户是谁" } },
    { page_idx: 2, chapter: "消费行为", evidence_fact_ids: ["F2"], questions: [{ code: "Q2" }] },
    { page_idx: 3, chapter: "体验评价", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 4, chapter: "体验评价", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 5, chapter: "建议", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 6, chapter: "建议", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
  ],
};

assert.deepEqual(Array.from(ai.chunkPages(reportContext.pages, 2), (batch) => batch.length), [3, 3]);
assert.deepEqual(Array.from(ai.chunkPages(reportContext.pages, 9), (batch) => batch.length), [5, 1]);

const narrative = ai.validateNarrative({
  findings: [{
    finding_id: "finding_ai",
    headline: "核心用户体验更好",
    description: "有事实支持",
    fact_ids: ["F1", "invented"],
    question_ids: ["Q1", "Q999"],
    business_implication: "优先经营",
    confidence: 2,
  }],
  storyline: [
    { page_idx: 1, role: "定义用户", transition: "开篇", focus_fact_ids: ["F1", "F2"] },
    { page_idx: 999, role: "无效页", focus_fact_ids: ["F1"] },
  ],
  executive_summary: "核心用户是当前机会重点",
}, reportContext);
assert.deepEqual(Array.from(narrative.findings[0].fact_ids), ["F1"]);
assert.deepEqual(Array.from(narrative.findings[0].question_ids), ["Q1"]);
assert.equal(narrative.findings[0].confidence, 1);
assert.equal(narrative.storyline.length, 6);
assert.deepEqual(Array.from(narrative.storyline[0].focus_fact_ids), ["F1"]);

const pageOutput = ai.validatePageOutput({ pages: [{
  page_idx: 1,
  title: "核心用户评价更集中",
  bullets: ["观察", "证据", "解释", "行动"],
  business_implication: "优先跟进",
  evidence_fact_ids: ["invented"],
  evidence_question_ids: ["Q999"],
}] }, reportContext.pages.slice(0, 3));
assert.equal(pageOutput.length, 1);
assert.deepEqual(Array.from(pageOutput[0].evidence_fact_ids), ["F1"]);
assert.deepEqual(Array.from(pageOutput[0].evidence_question_ids), ["Q1"]);
assert.equal(pageOutput[0].bullets.length, 3);
assert.match(pageOutput[0].bullets[2], /解释；行动/);

const batchInput = ai.buildPageBatchInput(reportContext.pages.slice(0, 3), narrative, pageOutput[0]);
assert.equal(batchInput.narrative.storyline.length, 3);
assert.equal(batchInput.previous_page.page_idx, 1);
const reportNarrative = ai.validateReportNarrative({
  report_title: "年轻用户手机购买体验研究",
  central_thesis: "年轻用户的购买阻碍主要来自价值感知与决策确定性不足，而非价格本身。",
  storyline_type: "diagnosis",
  chapters: [
    { chapter_id: "chapter_01", title: "用户画像", purpose: "界定核心用户", key_question: "谁是核心用户？" },
    { chapter_id: "chapter_02", title: "消费行为", purpose: "理解购买动机", key_question: "为什么购买？" },
    { chapter_id: "chapter_03", title: "优化机会", purpose: "形成增长动作", key_question: "如何提升转化？" },
  ],
  key_questions: ["谁是核心用户？", "为什么购买？", "如何提升转化？"],
  ending_message: "提升决策确定性比单纯降价更能推动转化。",
  confidence: 1.2,
}, reportContext);
assert.equal(reportNarrative.chapters.length, 3);
assert.equal(reportNarrative.storyline_type, "diagnosis");
assert.ok(reportNarrative.central_thesis);
assert.equal(reportNarrative.confidence, 1);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /中心论点/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /chapter_context/);

const narrativeBatch = ai.buildPageBatchInput(
  reportContext.pages.slice(0, 3), reportNarrative, null, reportContext.pages
);
assert.equal(narrativeBatch.central_thesis, reportNarrative.central_thesis);
assert.equal(narrativeBatch.pages[0].narrative_context.chapter_context.purpose, "界定核心用户");
assert.equal(narrativeBatch.pages[0].narrative_context.next_chapter, "消费行为");
assert.equal(narrativeBatch.pages[1].narrative_context.previous_chapter, "用户画像");

const fallbackResult = await ai.generateReportNarrativeOrFallback(async () => {
  throw new Error("simulated narrative failure");
}, reportContext);
assert.equal(fallbackResult.report_narrative, null);
assert.equal(fallbackResult.fallback_used, true);
const fallbackInput = ai.buildFallbackSlideBriefInput(reportContext);
assert.equal(fallbackInput.fallback_mode, "data_fact_to_slide_brief");
assert.equal(fallbackInput.pages.length, reportContext.pages.length);
assert.equal(fallbackInput.pages[0].narrative_context.central_thesis, "");


const modifiedBrief = {
  slide_id: "slide_01",
  title: "研究员标题",
  claim: "研究员结论",
  layout_family: "hero_chart",
  user_modified: true,
  locked: false,
};
assert.equal(
  JSON.stringify(ai.mergeSlideBriefSuggestion(modifiedBrief, {
    title: "AI 新标题",
    claim: "AI 新结论",
    layout_family: "comparison_40_60",
  })),
  JSON.stringify(modifiedBrief),
);
const lockedBrief = { ...modifiedBrief, user_modified: false, locked: true };
assert.equal(
  JSON.stringify(ai.mergeSlideBriefSuggestion(lockedBrief, { title: "AI 不得覆盖" })),
  JSON.stringify(lockedBrief),
);
const aiOwnedBrief = ai.mergeSlideBriefSuggestion(
  { slide_id: "slide_02", title: "旧标题", user_modified: false, locked: false },
  { title: "AI 更新标题", claim: "AI 更新结论" },
);
assert.equal(aiOwnedBrief.title, "AI 更新标题");
assert.equal(aiOwnedBrief.claim, "AI 更新结论");
assert.equal(aiOwnedBrief.user_modified, false);

console.log("PPT staged AI narrative smoke passed.");