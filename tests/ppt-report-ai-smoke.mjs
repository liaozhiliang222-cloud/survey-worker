import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.ok(html.indexOf("ppt-report-ai.js") < html.indexOf("app.js"), "PPT AI module must load before app.js.");
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
console.log("PPT staged AI narrative smoke passed.");