import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../research-theme.js", import.meta.url), "utf8"), {
  filename: "research-theme.js",
});

runInThisContext(readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8"), {
  filename: "ppt-report-ai.js",
});
const classifier = globalThis.ResearchThemeClassifier;
assert.ok(classifier, "Research Theme classifier should be exposed");
const ai = globalThis.PptReportAi;
assert.ok(ai, "PptReportAi should be exposed");

const context = {
  research_objective: "验证儿童学习设备概念的价值与产品方向",
  research_archetype: "concept_test",
  pages: [
    {
      page_idx: 1,
      source_chapter: "概念测试",
      page_type: "chart",
      questions: [{ code: "Q1", title: "功能需求分层" }],
    },
    {
      page_idx: 2,
      source_chapter: "概念测试",
      page_type: "driver_analysis",
      questions: [{ code: "Q2", title: "购买障碍分析" }],
    },
    {
      page_idx: 3,
      source_chapter: "用户画像",
      page_type: "segment_comparison",
      questions: [{ code: "Q3", title: "用户画像" }],
    },
  ],
};

const hints = classifier.buildResearchIntentHints(context);
assert.equal(hints.page_count, 3);
assert.equal(hints.pages, undefined, "intent hints must not duplicate page catalog");
assert.equal(hints.themes, undefined, "intent hints must not impose a fixed taxonomy");

const payload = {
  research_themes: [
    {
      theme_id: "concept_product",
      name: "概念价值与产品匹配",
      description: "判断产品概念是否满足用户的核心价值期待。",
      decision_area: "D1 概念验证",
      allowed_chapters: ["概念表现与转化潜力"],
      priority: 1,
    },
    {
      theme_id: "purchase_mechanism",
      name: "购买决策机制",
      description: "解释购买障碍和转化条件。",
      decision_area: "D2 决策机制",
      allowed_chapters: ["决策行为与驱动机制"],
      priority: 2,
    },
    {
      theme_id: "core_audience",
      name: "核心人群结构",
      description: "识别核心用户与人群差异。",
      decision_area: "D3 核心人群",
      allowed_chapters: ["核心人群与需求基础"],
      priority: 3,
    },
  ],
  chapter_rules: [
    { chapter: "概念表现与转化潜力", allowed_themes: ["concept_product"] },
    { chapter: "决策行为与驱动机制", allowed_themes: ["purchase_mechanism"] },
    { chapter: "核心人群与需求基础", allowed_themes: ["core_audience"] },
  ],
  research_theme_assignments: [
    { classification_id: "page:1", page_idx: 1, theme_id: "concept_product", chapter_reason: "用于验证产品功能价值。" },
    { classification_id: "page:2", page_idx: 2, theme_id: "purchase_mechanism", chapter_reason: "用于解释购买阻碍。" },
    { classification_id: "page:3", page_idx: 3, theme_id: "core_audience", chapter_reason: "用于识别人群结构。" },
  ],
};

const classification = classifier.parseNarrativeThemeClassification(payload, context);
assert.deepEqual(classification.themes.map((theme) => theme.theme_id), [
  "concept_product", "purchase_mechanism", "core_audience",
]);
assert.equal(classification.assignments.find((item) => item.page_idx === 1).research_theme, "concept_product");

const chapters = [
  {
    chapter_id: "chapter_01",
    title: "决策行为与驱动机制",
    allowed_themes: ["purchase_mechanism"],
    purpose: "解释决策",
    key_question: "为什么购买或放弃？",
    page_idxs: [1, 2],
  },
  {
    chapter_id: "chapter_02",
    title: "概念表现与转化潜力",
    allowed_themes: ["concept_product"],
    purpose: "验证概念",
    key_question: "概念是否有价值？",
    page_idxs: [],
  },
  {
    chapter_id: "chapter_03",
    title: "核心人群与需求基础",
    allowed_themes: ["core_audience"],
    purpose: "识别人群",
    key_question: "谁是核心用户？",
    page_idxs: [3],
  },
];
const reconciled = classifier.reconcileNarrativeThemes(chapters, classification, context);
assert.equal(reconciled.classification !== null, true);
assert.deepEqual(reconciled.chapters[0].page_idxs, [2]);
assert.deepEqual(reconciled.chapters[1].page_idxs, [1]);
assert.equal(reconciled.warnings[0].corrected, true);
assert.equal(classifier.findNarrativeThemeWarnings(
  { chapters: reconciled.chapters }, reconciled.classification
).length, 0);

const validated = ai.validateReportNarrative({
  report_title: "概念测试",
  central_thesis: "产品概念具备转化潜力，功能价值与核心人群需求需要继续匹配。",
  storyline_type: "problem_solution",
  research_themes: payload.research_themes,
  chapter_rules: payload.chapter_rules,
  research_theme_assignments: payload.research_theme_assignments,
  chapters,
  key_questions: [],
  ending_message: "明确产品方向。",
  confidence: 0.8,
}, { ...context, available_dimensions: [], require_page_blueprint: false });
assert.deepEqual(validated.chapters[0].page_idxs, [2]);
assert.deepEqual(validated.chapters[1].page_idxs, [1]);
assert.equal(validated.research_theme_classification.themes.length, 3);
const slideWarnings = classifier.findBlueprintThemeWarnings([
  { page_idx: 1, chapter: "概念表现与转化潜力", chapter_id: "chapter_02", questions: [{ code: "Q1" }] },
], { chapters: reconciled.chapters, research_theme_classification: reconciled.classification });
assert.equal(slideWarnings.length, 0);

console.log("Research Theme smoke passed: dynamic taxonomy, purpose classification and chapter correction");
