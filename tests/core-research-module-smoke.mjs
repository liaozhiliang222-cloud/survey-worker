import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const aiSource = readFileSync(new URL("../ppt-report-ai.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="pptxCoreResearchModule"/);
assert.doesNotMatch(html, /id="pptxStructureTemplate"/);
assert.match(appSource, /function populateCoreResearchModules\(/);
assert.match(appSource, /core_research_module:/);
assert.match(appSource, /applyCoreResearchModuleToPlan\(pagePlan\)/);

const context = vm.createContext({ globalThis: {}, Set, Map, Array, String, Number, JSON, Math, Promise, setTimeout });
vm.runInContext(aiSource, context);
const ai = context.globalThis.PptReportAi;
const concept = "\u6982\u5ff5\u6d4b\u8bd5";
const profile = "\u7528\u6237\u753b\u50cf";
const reportContext = {
  core_research_module: profile,
  pages: [
    { page_idx: 1, chapter: concept, source_chapter: concept, questions: [{ code: "B1", title: "\u8d2d\u4e70\u53ef\u80fd\u6027" }] },
    { page_idx: 2, chapter: profile, source_chapter: profile, research_role: "core", questions: [{ code: "S1", title: "\u5e74\u9f84\u4e0e\u5bb6\u5ead\u7ed3\u6784" }] },
    { page_idx: 3, chapter: "\u6d88\u8d39\u884c\u4e3a", source_chapter: "\u6d88\u8d39\u884c\u4e3a", questions: [{ code: "Q3", title: "\u8d2d\u4e70\u9891\u7387" }] },
  ],
};
assert.equal(ai.detectResearchArchetype(reportContext), "concept_test");
assert.deepEqual(Array.from(ai.coreResearchPageIndexes(reportContext)), [2]);
const input = ai.buildReportNarrativeInput(reportContext, "Concept report");
assert.equal(input.core_research_module, profile);
assert.deepEqual(Array.from(input.priority_page_idxs), [2]);
assert.match(input.priority_instructions.join(" "), /\u7528\u6237\u753b\u50cf/);
assert.doesNotMatch(input.priority_instructions.join(" "), /\u7b2c\u4e00\u7ae0\u5fc5\u987b/);
const result = ai.validateReportNarrative({
  report_title: "Concept report",
  central_thesis: "\u6838\u5fc3\u76ee\u6807\u7528\u6237\u662f\u5e74\u8f7b\u6709\u5b69\u5bb6\u5ead\uff0c\u5176\u9700\u6c42\u51b3\u5b9a\u540e\u7eed\u4ea7\u54c1\u4f18\u5316\u65b9\u5411\u3002",
  storyline_type: "diagnosis",
  chapters: [
    { title: profile, purpose: "Define audience", key_question: "Who", page_idxs: [2] },
    { title: concept, purpose: "Assess concept", key_question: "How", page_idxs: [1] },
    { title: "Action", purpose: "Recommend", key_question: "What next", page_idxs: [3] },
  ],
}, reportContext);
assert.equal(result.chapters[0].page_idxs[0], 2);
const storylineFirst = ai.validateReportNarrative({
  report_title: "Concept report",
  central_thesis: "\u6838\u5fc3\u76ee\u6807\u7528\u6237\u662f\u5e74\u8f7b\u6709\u5b69\u5bb6\u5ead\u3002",
  storyline_type: "diagnosis",
  chapters: [
    { title: concept, purpose: "Assess", key_question: "How", page_idxs: [1] },
    { title: profile, purpose: "Define", key_question: "Who", page_idxs: [2] },
    { title: "Action", purpose: "Recommend", key_question: "What next", page_idxs: [3] },
  ],
}, reportContext);
assert.equal(storylineFirst.chapters[0].page_idxs[0], 1);
assert.equal(storylineFirst.chapters[1].page_idxs[0], 2);
assert.doesNotMatch(ai.REPORT_NARRATIVE_SYSTEM_PROMPT, /\u4e2d\u5fc3\u8bba\u70b9\u4e0e\u7b2c\u4e00\u7ae0|\u7b2c\u4e00\u7ae0\u5fc5\u987b/);

console.log("Core research module smoke passed.");
