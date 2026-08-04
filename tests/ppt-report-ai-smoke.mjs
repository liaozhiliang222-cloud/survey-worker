import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.ok(html.indexOf("ppt-report-ai.js") < html.indexOf("app.js"), "PPT AI module must load before app.js.");
assert.ok(html.indexOf("research-theme.js") < html.indexOf("ppt-report-ai.js"), "Research Theme module must load before PPT AI.");
assert.match(html, /id="pptxNarrativePanel"/);
assert.match(html, /id="pptxNarrativeConfirmBtn"[^>]*>确认分析维度并生成蓝图</);
assert.match(html, /确认核心观点、章节与分析维度/);
assert.match(html, /对比图会自动包含总体基准，总体不占维度名额/);
assert.doesNotMatch(html, /不改变当前页数和顺序|不重排/);
assert.match(html, /id="pptxContinueEditBtn"/);
assert.match(html, /id="pptxNarrativeRegenerateBtn"[^>]*>重新生成故事线</);
assert.ok(html.indexOf('pptxNarrativeConfirmBtn') < html.indexOf('pptxNarrativeContent'), 'Narrative actions must appear before the long content.');
const context = vm.createContext({ globalThis: {}, Set, Map, Array, String, Number, JSON, Math, Promise, setTimeout });
vm.runInContext(source, context);
const ai = context.globalThis.PptReportAi;
assert.ok(ai, "PptReportAi must be exported.");
assert.deepEqual(
  ai.parseJsonObject('我们根据输入信息整理如下： {"central_thesis":"判断","nested":{"text":"保留 } 字符"}} 以上为结果。'),
  { central_thesis: "判断", nested: { text: "保留 } 字符" } },
);
assert.throws(() => ai.parseJsonObject("我们根据输入信息构建故事线。"), /未返回可解析的 JSON 对象/);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /最终由用户确认/);
assert.doesNotMatch(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /page_dimension_plan/);

const reportContext = {
  source: "survey.xlsx",
  available_dimensions: [
    { key: "总体", label: "总体", segments: ["Total"] },
    { key: "用户类型", label: "用户类型", segments: ["新用户", "老用户"] },
    { key: "年龄", label: "年龄", segments: ["18-29岁", "30岁以上"] },
  ],
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
    { page_idx: 1, chapter: "用户画像", evidence_fact_ids: ["F1"], questions: [{ code: "Q1", title: "年龄分布", data_kind: "percentage", base: { "总体": 320 }, rows: [{ option: "18-25岁", values: { "总体": 42.5 } }], facts: [{ fact_id: "F1", fact_type: "top_category", metric_name: "18-25岁", category: "18-25岁", value: 42.5, base: 320, source_reference: "Q1.年龄分布", confidence: 1 }] }], slide_brief: { question_answered: "用户是谁" } },
    { page_idx: 2, chapter: "消费行为", evidence_fact_ids: ["F2"], questions: [{ code: "Q2" }] },
    { page_idx: 3, chapter: "体验评价", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 4, chapter: "体验评价", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 5, chapter: "建议", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
    { page_idx: 6, chapter: "建议", evidence_fact_ids: ["F3"], questions: [{ code: "Q3" }] },
  ],
};

assert.deepEqual(Array.from(ai.chunkPages(reportContext.pages, 2), (batch) => batch.length), [3, 3]);
assert.deepEqual(Array.from(ai.chunkPages(reportContext.pages, 9), (batch) => batch.length), [6]);
assert.equal(ai.DEFAULT_BATCH_SIZE, 4);
assert.equal(ai.REPAIR_BATCH_SIZE, 2);
assert.equal(ai.SLIDE_BRIEF_CONCURRENCY, 3);
assert.equal(ai.SLIDE_BRIEF_TIMEOUT_MS, 150000);
assert.equal(ai.SLIDE_BRIEF_REPAIR_TIMEOUT_MS, 90000);
assert.deepEqual(
  Array.from(ai.chapterAnalysisDimensions({
    baseline_dimension: "总体",
    primary_dimensions: ["购买意向"],
    supporting_dimensions: ["孩子年龄"],
  })),
  ["购买意向", "孩子年龄"],
);
assert.deepEqual(
  Array.from(ai.chapterAnalysisDimensions({ baseline_dimension: "总体" })),
  ["总体"],
);
const chapterBatches = ai.chunkPagesByChapter(reportContext.pages, 6);
assert.deepEqual(Array.from(chapterBatches, (batch) => batch.length), [1, 1, 2, 2]);
assert.ok(Array.from(chapterBatches).every((batch) => new Set(Array.from(batch, (page) => page.chapter)).size === 1));
assert.equal(ai.filterWritablePages([
  { slide_brief: { locked: true } },
  { slide_brief: { user_modified: true } },
  { slide_brief: { locked: false, user_modified: false } },
]).length, 1);
const largePlan = Array.from({ length: 84 }, (_, index) => ({
  page_idx: index + 1,
  chapter: `章节${Math.floor(index / 21) + 1}`,
}));
const largePlanBatches = ai.chunkPagesByChapter(largePlan, 6);
assert.equal(largePlanBatches.length, 24);
assert.ok(Array.from(largePlanBatches).every((batch) => batch.length <= 4));
assert.deepEqual(
  Array.from(ai.chunkRepairPages(largePlan.slice(0, 5), 9), (batch) => batch.length),
  [2, 2, 1]
);

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
  claim: "Decision certainty is the core barrier.",
  bullets: ["观察", "证据", "解释", "行动"],
  business_implication: "优先跟进",
  evidence_fact_ids: ["invented"],
  evidence_question_ids: ["Q999"],
}] }, reportContext.pages.slice(0, 3));
assert.equal(pageOutput.length, 1);
assert.equal(pageOutput[0].claim, "Decision certainty is the core barrier.");
assert.deepEqual(Array.from(pageOutput[0].evidence_fact_ids), ["F1"]);
assert.deepEqual(Array.from(pageOutput[0].evidence_question_ids), ["Q1"]);
assert.equal(pageOutput[0].bullets.length, 3);
const narrationPayload = { pages: [{
  page_idx: 1,
  title: "Preference is concentrated",
  claim: "Preference is concentrated",
  bullets: ["Option A reaches 48%", "Option B reaches 32%", "The pattern shows a concentrated preference structure"],
  business_implication: "Prioritize the 48% leading proposition",
}] };
assert.ok(ai.findDataNarrationIssues(narrationPayload.pages).length >= 1);
const reducedNarration = ai.validatePageOutput(narrationPayload, reportContext.pages.slice(0, 1));
assert.deepEqual(
  Array.from(reducedNarration[0].bullets),
  ["The pattern shows a concentrated preference structure"],
);
assert.equal(reducedNarration[0].bullets.filter((bullet) => bullet.includes("%")).length, 0);
assert.equal(reducedNarration[0].business_implication, "");
assert.ok(ai.SLIDE_BRIEF_SYSTEM_PROMPT.includes("bullets[0]"));
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /business_implication/);
assert.match(pageOutput[0].bullets[2], /解释；行动/);

const batchInput = ai.buildPageBatchInput(reportContext.pages.slice(0, 3), narrative, pageOutput[0]);
assert.equal(batchInput.previous_page.page_idx, 1);
assert.equal(batchInput.pages[0].questions[0].facts[0].fact_id, "F1");
assert.equal(batchInput.pages[0].questions[0].facts[0].value, 42.5);
assert.equal(batchInput.pages[0].questions[0].rows[0].values["总体"], 42.5);
assert.equal(batchInput.pages[0].questions[0].facts[0].source_reference, undefined);
assert.doesNotMatch(JSON.stringify(batchInput), /"slide_brief":|"page_contexts":|"narrative_context":|"report_narrative":/);
const compactBatchInput = ai.buildPageBatchInput([{
  page_idx: 7,
  chapter: "测试章节",
  evidence_fact_ids: ["F_KEEP"],
  questions: [{
    code: "Q7",
    title: "测试题",
    rows: [
      { option: "保留选项", values: { 总体: 61 } },
      { option: "无关选项", values: { 总体: 39 } },
    ],
    facts: [
      { fact_id: "F_KEEP", category: "保留选项", value: 61, source_reference: "Q7.保留选项" },
      { fact_id: "F_DROP", category: "无关选项", value: 39, source_reference: "Q7.无关选项" },
    ],
  }],
}], narrative);
assert.deepEqual(Array.from(compactBatchInput.pages[0].questions[0].facts, (fact) => fact.fact_id), ["F_KEEP"]);
assert.deepEqual(Array.from(compactBatchInput.pages[0].questions[0].rows, (row) => row.option), ["保留选项"]);
assert.equal(compactBatchInput.pages[0].questions[0].facts[0].source_reference, undefined);
const reportNarrative = ai.validateReportNarrative({
  report_title: "年轻用户手机购买体验研究",
  central_thesis: "年轻用户的购买阻碍主要来自价值感知与决策确定性不足，而非价格本身。",
  storyline_type: "diagnosis",
  chapters: [
    { chapter_id: "chapter_01", title: "用户画像", purpose: "界定核心用户", key_question: "谁是核心用户？", page_idxs: [3, 1], analysis_strategy: { baseline_dimension: "总体", primary_dimensions: ["用户类型", "年龄"], supporting_dimensions: ["不存在", "年龄"], rationale: "识别核心用户差异", page_dimension_plan: [{ page_idx: 3, dimensions: ["年龄"] }, { page_idx: 999, dimensions: ["用户类型"] }] } },
    { chapter_id: "chapter_02", title: "消费行为", purpose: "理解购买动机", key_question: "为什么购买？", page_idxs: [2, 4] },
    { chapter_id: "chapter_03", title: "优化机会", purpose: "形成增长动作", key_question: "如何提升转化？", page_idxs: [6, 5] },
  ],
  key_questions: ["谁是核心用户？", "为什么购买？", "如何提升转化？"],
  ending_message: "提升决策确定性比单纯降价更能推动转化。",
  confidence: 1.2,
}, reportContext);
assert.equal(reportNarrative.chapters.length, 3);
assert.equal(reportNarrative.storyline_type, "diagnosis");
assert.equal(ai.validateReportNarrative({ ...reportNarrative, storyline_type: "诊断型叙事" }, reportContext).storyline_type, "diagnosis");
assert.equal(ai.validateReportNarrative({ ...reportNarrative, storyline_type: "问题-解决" }, reportContext).storyline_type, "problem_solution");
assert.equal(ai.validateReportNarrative({ ...reportNarrative, storyline_type: "洞察驱动" }, reportContext).storyline_type, "diagnosis");
assert.ok(reportNarrative.central_thesis);
const { central_thesis: expectedCentralThesis, ...camelCaseNarrative } = reportNarrative;
const normalizedWrappedNarrative = ai.validateReportNarrative({
  reportNarrative: {
    ...camelCaseNarrative,
    centralThesis: expectedCentralThesis,
  },
}, reportContext);
assert.equal(normalizedWrappedNarrative.central_thesis, expectedCentralThesis);
assert.equal(reportNarrative.confidence, 1);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /中心论点/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /chapter_context/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /正文不得引用百分比/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /不得逐项复述图表/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /可能与…有关/);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /page_idxs/);
assert.match(ai.PAGE_BLUEPRINT_SYSTEM_PROMPT, /page_blueprint/);
assert.match(ai.PAGE_BLUEPRINT_SYSTEM_PROMPT, /每页 1–6 题/);
assert.equal(reportNarrative.chapters[0].page_idxs.join(","), "3,1");
assert.deepEqual(Array.from(reportNarrative.chapters[0].analysis_strategy.primary_dimensions), ["用户类型"]);
assert.deepEqual(Array.from(reportNarrative.chapters[0].analysis_strategy.supporting_dimensions), ["年龄"]);
assert.equal(reportNarrative.chapters[0].analysis_strategy.page_dimension_plan.length, 1);
const reportNarrativeInput = ai.buildReportNarrativeInput(reportContext, "研究目标");
assert.deepEqual(Array.from(reportNarrativeInput.dimension_catalog, (item) => item.key), ["总体", "用户类型", "年龄"]);
assert.equal(reportNarrativeInput.require_page_blueprint, true);
const frameworkInput = ai.buildReportFrameworkInput(reportNarrativeInput);
assert.equal(frameworkInput.data_facts, undefined);
assert.equal(frameworkInput.require_page_blueprint, undefined);
assert.ok(frameworkInput.insights.length <= 12);
assert.equal(frameworkInput.question_catalog, undefined);
assert.equal(frameworkInput.dimension_catalog[0].segments, undefined);
assert.equal(frameworkInput.page_catalog[0].question_titles, undefined);
const revisionInput = ai.buildReportNarrativeRevisionInput(
  reportNarrative,
  { ...reportContext, require_page_blueprint: false },
  "move question assignment to concept validation",
  "research objective",
);
assert.equal(revisionInput.revision_feedback, "move question assignment to concept validation");
assert.equal(revisionInput.current_narrative.chapters.length, 3);
assert.equal(revisionInput.require_page_blueprint, false);
assert.equal(revisionInput.current_narrative.chapters[0].page_idxs.join(","), "3,1");
const localReportNarrative = ai.validateReportNarrative(
  ai.buildFallbackReportNarrative(reportContext, reportNarrativeInput),
  { ...reportContext, require_page_blueprint: false },
);
assert.ok(localReportNarrative.chapters.length >= 3 && localReportNarrative.chapters.length <= 8);
assert.equal(localReportNarrative.storyline_type, "diagnosis");
assert.equal(ai.isReportNarrativeTooSimilarToSource(localReportNarrative, reportNarrativeInput), false);
assert.deepEqual(
  Array.from(new Set(localReportNarrative.chapters.flatMap((chapter) => chapter.page_idxs))).sort((a, b) => a - b),
  Array.from(reportContext.pages, (page) => page.page_idx).sort((a, b) => a - b),
);
assert.deepEqual(Array.from(reportNarrativeInput.question_catalog, (item) => item.question_id), ["Q1", "Q2", "Q3"]);
const fallbackBlueprint = ai.buildFallbackPageBlueprint(reportContext, reportNarrative);
const fallbackQuestionIds = fallbackBlueprint.flatMap((page) => page.question_ids);
assert.deepEqual(Array.from(fallbackQuestionIds).sort(), ["Q1", "Q2", "Q3"]);
assert.equal(new Set(fallbackQuestionIds).size, fallbackQuestionIds.length);
assert.ok(fallbackBlueprint.every((page) => page.question_ids.length >= 1 && page.question_ids.length <= 6));
ai.validateReportNarrative({ ...reportNarrative, page_blueprint: fallbackBlueprint }, { ...reportContext, require_page_blueprint: true });
const logicFirstBlueprint = ai.buildFallbackPageBlueprint({ pages: [
  {
    page_idx: 1,
    source_chapter: "购买行为",
    current_title: "购买行为概览",
    questions: [
      { code: "S1", title: "购买渠道", rows: [{ option: "线上", values: { 总体: 50 } }] },
      { code: "S2", title: "购买频率", rows: [{ option: "每月", values: { 总体: 40 } }] },
    ],
  },
  {
    page_idx: 2,
    source_chapter: "购买行为",
    current_title: "复杂模型分析",
    questions: [{
      code: "C1",
      title: "复杂矩阵",
      data_kind: "matrix",
      model_semantics: { analysis_model: "kano" },
      rows: Array.from({ length: 12 }, (_, index) => ({
        option: `选项${index + 1}`,
        values: { 总体: 25, A组: 20, B组: 30, C组: 35 },
      })),
    }],
  },
] }, {
  chapters: [{ chapter_id: "chapter_logic", title: "购买行为", key_question: "用户如何购买？", page_idxs: [1, 2] }],
});
assert.deepEqual(Array.from(logicFirstBlueprint, (page) => page.question_ids.join(",")), ["S1,S2", "C1"]);
assert.ok(logicFirstBlueprint.every((page) => page.question_ids.length <= 6));
const fiveSeriesRows = (options) => options.map((option) => ({
  option,
  values: { 总体: 50, 高意向用户: 55, "0-6岁": 45, "7-9岁": 60, "10-12岁": 48 },
}));
const compactProfileBlueprint = ai.buildFallbackPageBlueprint({ pages: [
  { page_idx: 1, source_chapter: "用户画像", current_title: "城市分布", questions: [{ code: "S3", title: "目前居住的城市", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["一线", "新一线", "省会"]) }] },
  { page_idx: 2, source_chapter: "用户画像", current_title: "家庭阶段", questions: [{ code: "S4", title: "以下哪种符合您的家庭情况", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["0-6岁", "7-9岁", "10-12岁"]) }] },
  { page_idx: 3, source_chapter: "其他研究", current_title: "孩子性别", questions: [{ code: "S5", title: "您孩子的性别", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["男", "女"]) }] },
  { page_idx: 4, source_chapter: "用户画像", current_title: "家长学历", questions: [{ code: "C1", title: "您的最高学历", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["高中", "大专", "本科", "硕士"]) }] },
  { page_idx: 5, source_chapter: "用户画像", current_title: "家长职业", questions: [{ code: "C2", title: "您的职业", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["企业职员", "专业人员", "自由职业"]) }] },
  { page_idx: 6, source_chapter: "用户画像", current_title: "家庭收入", questions: [{ code: "C3", title: "您的家庭月总收入", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["1万元以下", "1-2万元", "2-3万元", "3万元以上"]) }] },
  { page_idx: 7, source_chapter: "概念测试", current_title: "插电影响", questions: [{ code: "B7", title: "设备需要插电使用的影响", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["影响很大", "有影响", "无影响"]) }] },
  { page_idx: 8, source_chapter: "概念测试", current_title: "续航期望", questions: [{ code: "B8", title: "电池续航期望", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["1-2天", "3-5天", "1周"]) }] },
  { page_idx: 9, source_chapter: "概念测试", current_title: "便携需求", questions: [{ code: "B9", title: "是否需要设备支持便携移动", model_semantics: { analysis_model: "descriptive" }, rows: fiveSeriesRows(["经常", "偶尔", "不需要"]) }] },
  { page_idx: 10, source_chapter: "专项研究", current_title: "KANO分析", questions: [{ code: "K1", title: "功能KANO分类", data_kind: "matrix", model_semantics: { analysis_model: "kano" }, rows: fiveSeriesRows(["功能A", "功能B"]) }] },
] }, {
  chapters: [{ chapter_id: "chapter_compact", title: "用户与产品机会", key_question: "哪些用户和产品要素最值得关注？", page_idxs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
});
assert.deepEqual(Array.from(compactProfileBlueprint, (page) => page.question_ids.join(",")), [
  "S3,S4,S5,C1,C2,C3",
  "B7,B8,B9",
  "K1",
]);
assert.equal(compactProfileBlueprint[0].title, "核心用户与家庭画像");
assert.equal(compactProfileBlueprint[1].title, "供电、续航与便携需求");
assert.ok(compactProfileBlueprint.every((page) => page.question_ids.length >= 1 && page.question_ids.length <= 6));
const strictBlueprintContext = { ...reportContext, require_page_blueprint: true };
assert.throws(
  () => ai.validateReportNarrative(reportNarrative, strictBlueprintContext),
  /缺少 page_blueprint/,
);
const blueprintNarrative = ai.validateReportNarrative({
  ...reportNarrative,
  page_blueprint: [
    { page_id: "logic_01", chapter_id: "chapter_01", title: "画像解释体验差异", purpose: "连接画像与体验", question_ids: ["Q1", "Q3"] },
    { page_id: "logic_02", chapter_id: "chapter_02", title: "购买行为", purpose: "解释购买动机", question_ids: ["Q2"] },
  ],
}, strictBlueprintContext);
assert.deepEqual(Array.from(blueprintNarrative.page_blueprint[0].question_ids), ["Q1", "Q3"]);
assert.deepEqual(Array.from(blueprintNarrative.page_blueprint[0].question_titles), ["年龄分布", "Q3"]);
assert.throws(
  () => ai.validateReportNarrative({
    ...reportNarrative,
    page_blueprint: [
      { page_id: "dup_01", chapter_id: "chapter_01", question_ids: ["Q1", "Q2"] },
      { page_id: "dup_02", chapter_id: "chapter_02", question_ids: ["Q2", "Q3"] },
    ],
  }, strictBlueprintContext),
  /重复分配题目 Q2/,
);
const recomposedByQuestions = ai.recomposePagesByNarrative(reportContext.pages, blueprintNarrative);
assert.deepEqual(
  Array.from(recomposedByQuestions, (page) => page.questions.map((question) => question.code).join(",")),
  ["Q1,Q3", "Q2"],
  "Narrative page_blueprint must regroup questions across the initial deterministic pages",
);
assert.deepEqual(Array.from(recomposedByQuestions, (page) => page.title), ["画像解释体验差异", "购买行为"]);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /analysis_strategy/);
const pagesWithStableIds = reportContext.pages.map((page, index) => ({
  ...page,
  slide_brief: {
    ...(page.slide_brief || {}),
    slide_id: "slide_" + (index + 1),
    title: index === 2 ? "Manual title" : "",
    user_modified: index === 2,
    locked: false,
  },
}));
const reorganizedPages = ai.organizePagesByNarrative(pagesWithStableIds, reportNarrative);
assert.deepEqual(
  Array.from(reorganizedPages, (page) => page.slide_brief.slide_id),
  ["slide_3", "slide_1", "slide_2", "slide_4", "slide_6", "slide_5"],
  "Narrative page_idxs must control final chapter and page order",
);
assert.deepEqual(Array.from(reorganizedPages, (page) => page.page_idx), [1, 2, 3, 4, 5, 6]);
assert.equal(reorganizedPages[0].slide_brief.title, "Manual title");
assert.equal(reorganizedPages[0].slide_brief.user_modified, true);
assert.equal(reorganizedPages[0].slide_brief.chapter_id, "chapter_01");
const narrativeWithoutAssignments = {
  ...reportNarrative,
  chapters: reportNarrative.chapters.map(({ page_idxs, ...chapter }) => chapter),
};
const fallbackOrganizedPages = ai.organizePagesByNarrative(
  pagesWithStableIds, narrativeWithoutAssignments
);
assert.equal(
  new Set(Array.from(fallbackOrganizedPages, (page) => page.chapter_id)).size,
  reportNarrative.chapters.length,
  "Deterministic fallback must keep every Narrative chapter represented",
);

const narrativeBatch = ai.buildPageBatchInput(
  reportContext.pages.slice(0, 3), reportNarrative, null, reportContext.pages
);
assert.equal(narrativeBatch.central_thesis, reportNarrative.central_thesis);
assert.equal(narrativeBatch.chapter_context.purpose, "界定核心用户");
assert.deepEqual(Array.from(narrativeBatch.chapter_context.analysis_strategy.primary_dimensions), ["用户类型"]);
assert.equal(narrativeBatch.previous_chapter, "");
assert.equal(narrativeBatch.next_chapter, "消费行为");
assert.equal(narrativeBatch.pages[0].narrative_context, undefined);

const repeatedSourceChapters = ["画像", "行为", "画像", "体验", "行为"].map((chapter, index) => ({
  page_idx: index + 1,
  chapter,
}));
const assignedNarrativeChapters = repeatedSourceChapters.map((page) =>
  ai.buildPageNarrativeContext(page, reportNarrative, repeatedSourceChapters).chapter_context.title
);
assert.deepEqual(
  Array.from(assignedNarrativeChapters),
  ["用户画像", "消费行为", "消费行为", "优化机会", "优化机会"],
  "Narrative chapters must move forward without creating repeated section dividers",
);

const fallbackResult = await ai.generateReportNarrativeOrFallback(async () => {
  throw new Error("simulated narrative failure");
}, reportContext);
assert.equal(fallbackResult.report_narrative, null);
assert.equal(fallbackResult.fallback_used, true);
const fallbackInput = ai.buildFallbackSlideBriefInput(reportContext);
assert.equal(fallbackInput.fallback_mode, "data_fact_to_slide_brief");
assert.equal(fallbackInput.pages.length, reportContext.pages.length);
assert.equal(fallbackInput.central_thesis, "");
assert.equal(fallbackInput.chapter_context, null);

let activeWorkers = 0;
let maxActiveWorkers = 0;
const progressEvents = [];
const mapped = await ai.mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
  activeWorkers += 1;
  maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
  await new Promise((resolve) => setTimeout(resolve, 5));
  activeWorkers -= 1;
  return value * 2;
}, (completed, total) => progressEvents.push([completed, total]));
assert.deepEqual(Array.from(mapped), [2, 4, 6, 8, 10]);
assert.equal(maxActiveWorkers, 2);
assert.equal(progressEvents.length, 5);
assert.deepEqual(progressEvents.at(-1), [5, 5]);
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

const stableBatch = reportContext.pages.slice(0, 2).map((page, index) => ({
  ...page,
  slide_id: `stable_${index + 1}`,
  questions: (page.questions || []).map((question) => ({
    ...question,
    model_semantics: { analysis_model: index === 0 ? "psm" : "descriptive" },
    data_quality_warnings: index === 0 ? [{ code: "repaired" }] : [],
  })),
}));
const stableOutput = ai.validatePageOutput({ pages: [{
  slide_id: "stable_2",
  page_idx: 1,
  title: "Stable ID wins",
  evidence_fact_ids: ["F2"],
  evidence_question_ids: ["Q2"],
}] }, stableBatch);
assert.equal(stableOutput.length, 1);
assert.equal(stableOutput[0].slide_id, "stable_2");
assert.equal(stableOutput[0].page_idx, 2);
const strictPageIdOutput = ai.validatePageOutput({ pages: [{
  page_idx: 1,
  title: "Page index alone must not bind",
  evidence_fact_ids: ["F1"],
}] }, stableBatch, { requireSlideId: true });
assert.equal(strictPageIdOutput.length, 0);
const strictStableOutput = ai.validatePageOutput({ pages: [{
  slide_id: "stable_1",
  title: "Stable ID binds",
  evidence_fact_ids: ["F1"],
  evidence_question_ids: ["Q1"],
}] }, stableBatch, { requireSlideId: true });
const invalidEvidenceOutput = ai.validatePageOutput({ pages: [{
  slide_id: "stable_1",
  title: "Invalid evidence is replaced deterministically",
  evidence_fact_ids: ["invented"],
  evidence_question_ids: ["Q999"],
}] }, stableBatch, { requireSlideId: true });
assert.equal(strictStableOutput[0].slide_id, "stable_1");
assert.deepEqual(invalidEvidenceOutput[0].evidence_fact_ids, ["F1"]);
assert.deepEqual(invalidEvidenceOutput[0].evidence_question_ids, ["Q1"]);
const missingEvidenceOutput = ai.validatePageOutput({ pages: [{
  slide_id: "stable_1",
  title: "System backfills omitted evidence IDs",
}] }, stableBatch, { requireSlideId: true });
assert.deepEqual(missingEvidenceOutput[0].evidence_fact_ids, ["F1"]);
assert.deepEqual(missingEvidenceOutput[0].evidence_question_ids, ["Q1"]);

const stableInput = ai.buildPageBatchInput(stableBatch, reportNarrative);
assert.equal(stableInput.pages[0].slide_id, "stable_1");
assert.equal(stableInput.pages[0].questions[0].model_semantics.analysis_model, "psm");
assert.equal(stableInput.pages[0].questions[0].data_quality_warnings[0].code, "repaired");
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /slide_id/);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /PSM/);
assert.equal(ai.evidenceLabelMatchesClause("高购买意向用户几乎每天骑行", "几乎每天都骑"), true);
assert.equal(ai.evidenceLabelMatchesClause("高购买意向用户几乎每天骑行", "每周3-5天"), false);
assert.match(ai.SLIDE_BRIEF_SYSTEM_PROMPT, /子样本/);


const conceptContext = {
  source: "concept.xlsx",
  available_dimensions: [{ key: "\u8d2d\u4e70\u610f\u5411", segments: ["\u9ad8\u610f\u5411\u7528\u6237"] }],
  pages: [
    {
      page_idx: 1,
      chapter: "\u6982\u5ff5\u6d4b\u8bd5",
      current_title: "\u4ea7\u54c1\u6982\u5ff5\u7684\u8d2d\u4e70\u53ef\u80fd",
      questions: [{ code: "B1", title: "\u4e86\u89e3\u8fd9\u4e2a\u4ea7\u54c1\u6982\u5ff5\u540e\uff0c\u60a8\u8d2d\u4e70\u5b83\u7684\u53ef\u80fd\u6027\u6709\u591a\u5927" }],
    },
    {
      page_idx: 2,
      chapter: "\u7528\u6237\u753b\u50cf",
      current_title: "\u76ee\u6807\u7528\u6237\u7279\u5f81",
      questions: [{ code: "S1", title: "\u60a8\u7684\u6027\u522b\u662f" }],
    },
    {
      page_idx: 3,
      chapter: "\u6982\u5ff5\u6d4b\u8bd5",
      current_title: "\u8d2d\u4e70\u969c\u788d",
      questions: [{ code: "B3", title: "\u4e3a\u4ec0\u4e48\u4e0d\u8003\u8651\u8d2d\u4e70" }],
    },
  ],
};
assert.equal(ai.detectResearchArchetype(conceptContext), "concept_test");
assert.deepEqual(Array.from(ai.conceptPriorityPageIndexes(conceptContext)), [1]);
const conceptInput = ai.buildReportNarrativeInput(conceptContext, "BC10 Kids");
assert.equal(conceptInput.research_archetype, "concept_test");
assert.deepEqual(Array.from(conceptInput.priority_page_idxs), [1]);
assert.match(conceptInput.priority_instructions.join(" "), /\u6982\u5ff5\u8868\u73b0/);
const copiedConceptFramework = {
  chapters: conceptInput.current_report_structure.map((chapter, index) => ({
    chapter_id: `copied_${index + 1}`,
    title: chapter.title,
    page_idxs: chapter.page_idxs,
  })),
};
assert.equal(ai.isReportNarrativeTooSimilarToSource(copiedConceptFramework, conceptInput), true);
const logicConceptNarrative = ai.validateReportNarrative(
  ai.buildFallbackReportNarrative(conceptContext, conceptInput),
  { ...conceptContext, require_page_blueprint: false },
);
assert.equal(logicConceptNarrative.storyline_type, "problem_solution");
assert.deepEqual(Array.from(logicConceptNarrative.chapters, (chapter) => chapter.title), [
  "\u6982\u5ff5\u8868\u73b0\u4e0e\u8f6c\u5316\u6f5c\u529b",
  "\u6838\u5fc3\u4eba\u7fa4\u4e0e\u9700\u6c42\u57fa\u7840",
  "\u8f6c\u5316\u969c\u788d\u4e0e\u98ce\u9669\u8bca\u65ad",
]);
assert.equal(ai.isReportNarrativeTooSimilarToSource(logicConceptNarrative, conceptInput), false);
assert.deepEqual(
  Array.from(new Set(logicConceptNarrative.chapters.flatMap((chapter) => chapter.page_idxs))).sort((a, b) => a - b),
  [1, 2, 3],
);
const conceptChapters = [
  {
    chapter_id: "chapter_01",
    title: "\u6982\u5ff5\u6574\u4f53\u8868\u73b0",
    purpose: "\u5224\u65ad\u4ea7\u54c1\u6982\u5ff5\u7684\u8f6c\u5316\u6f5c\u529b",
    key_question: "\u6982\u5ff5\u662f\u5426\u5177\u5907\u8d2d\u4e70\u6f5c\u529b\uff1f",
    page_idxs: [1],
  },
  {
    chapter_id: "chapter_02",
    title: "\u76ee\u6807\u7528\u6237",
    purpose: "\u89e3\u91ca\u6838\u5fc3\u4eba\u7fa4",
    key_question: "\u8c01\u6700\u53ef\u80fd\u8d2d\u4e70\uff1f",
    page_idxs: [2],
  },
  {
    chapter_id: "chapter_03",
    title: "\u8f6c\u5316\u969c\u788d",
    purpose: "\u8bc6\u522b\u4f18\u5316\u65b9\u5411",
    key_question: "\u5982\u4f55\u63d0\u5347\u8f6c\u5316\uff1f",
    page_idxs: [3],
  },
];
const conceptPayload = {
  report_title: "BC10 Kids",
  central_thesis: "\u4ea7\u54c1\u6982\u5ff5\u5177\u5907\u8f6c\u5316\u6f5c\u529b\uff0c\u4f46\u8d2d\u4e70\u610f\u5411\u4ecd\u53d7\u6838\u5fc3\u969c\u788d\u5236\u7ea6\u3002",
  storyline_type: "diagnosis",
  chapters: conceptChapters,
  key_questions: ["\u6982\u5ff5\u8868\u73b0\u5982\u4f55\uff1f"],
  ending_message: "\u4f18\u5148\u89e3\u51b3\u5173\u952e\u969c\u788d\u4ee5\u91ca\u653e\u8f6c\u5316\u6f5c\u529b\u3002",
  confidence: 0.9,
};
assert.ok(ai.validateReportNarrative(conceptPayload, conceptContext).central_thesis);
const storylineLedConcept = ai.validateReportNarrative({
  ...conceptPayload,
  chapters: [conceptChapters[1], conceptChapters[0], conceptChapters[2]],
}, conceptContext);
assert.equal(storylineLedConcept.chapters[0].page_idxs[0], 2);
assert.equal(storylineLedConcept.chapters[1].page_idxs[0], 1);
assert.throws(
  () => ai.validateReportNarrative({
    ...conceptPayload,
    central_thesis: "\u9ad8\u610f\u5411\u7528\u6237\u5728\u5e74\u9f84\u548c\u5bb6\u5ead\u7ed3\u6784\u4e0a\u5177\u6709\u660e\u663e\u7279\u5f81\u3002",
  }, conceptContext),
  /central_thesis/,
);
assert.match(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /research_archetype=concept_test/);

console.log("PPT staged AI narrative smoke passed.");
