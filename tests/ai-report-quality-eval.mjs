import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/ai-report-quality-cases.json", import.meta.url), "utf8"
));
const context = vm.createContext({ globalThis: {}, Set, Map, Array, String, Number, JSON, Math, Promise, setTimeout });
vm.runInContext(source, context);
const ai = context.globalThis.PptReportAi;

for (const testCase of fixture.blueprint_cases) {
  const pages = testCase.questions.map((question, index) => ({
    page_idx: index + 1,
    chapter: testCase.chapter,
    source_chapter: testCase.chapter,
    current_title: question.title,
    questions: [{
      code: question.code,
      title: question.title,
      data_kind: question.analysis_model ? "matrix" : "percentage",
      model_semantics: { analysis_model: question.analysis_model || "descriptive" },
      rows: [{ option: "示例", values: { 总体: 50 } }],
    }],
  }));
  const narrative = {
    chapters: [{
      chapter_id: "chapter_01",
      title: testCase.chapter,
      purpose: "回答本章研究问题并形成决策判断。",
      key_question: "本章证据共同说明什么？",
      page_idxs: pages.map((page) => page.page_idx),
    }],
  };
  const blueprint = ai.buildFallbackPageBlueprint({ pages }, narrative);
  assert.deepEqual(
    Array.from(blueprint, (page) => Array.from(page.question_ids)),
    testCase.expected_groups,
    `${testCase.id}: related questions should follow the gold grouping`,
  );
}

for (const testCase of fixture.copy_cases) {
  const result = ai.auditSlideBriefQuality(testCase.pages);
  assert.equal(result.status, testCase.expected_status, `${testCase.id}: unexpected quality status`);
  if (testCase.expected_issue) {
    assert.ok(result.issues.some((issue) => issue.code === testCase.expected_issue));
  }
}

console.log(`AI report quality eval passed: ${fixture.blueprint_cases.length} blueprint cases, ${fixture.copy_cases.length} copy cases.`);
