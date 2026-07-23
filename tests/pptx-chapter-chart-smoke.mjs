import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function isPptxChapterChartEligible(");
const end = source.indexOf("(function initPptxReportPage()", start);
assert.ok(start >= 0 && end > start, "Chapter chart helpers must be defined before page initialization.");
const context = vm.createContext({ Set, Array, String, Boolean });
vm.runInContext(source.slice(start, end), context);

const plan = {
  pages: [
    { chapter: "用户画像", chart_type: "auto", questions: [{ code: "Q1" }] },
    { chapter: "用户画像", chart_type: "doughnut", chart_type_source: "page", questions: [{ code: "Q2" }] },
    { chapter: "用户画像", chart_type: "auto", slide_type: "funnel_analysis", questions: [{ code: "Q3" }] },
    { chapter: "消费行为", chart_type: "auto", questions: [{ code: "Q4" }] },
  ],
};

let result = context.applyPptxChapterChartType(plan, "用户画像", "bar", false);
assert.deepEqual(JSON.parse(JSON.stringify(result)), { eligible: 2, updated: 1, preserved: 1, skipped: 1 });
assert.equal(plan.pages[0].chart_type, "bar");
assert.equal(plan.pages[0].chart_type_source, "chapter");
assert.equal(plan.pages[1].chart_type, "doughnut");
assert.equal(plan.pages[2].chart_type, "auto");
assert.equal(plan.pages[3].chart_type, "auto");

result = context.applyPptxChapterChartType(plan, "用户画像", "column", false);
assert.equal(result.updated, 1, "Changing chapter strategy must update earlier chapter-applied pages.");
assert.equal(result.preserved, 1, "Per-page customizations must remain protected.");
assert.equal(plan.pages[0].chart_type, "column");

result = context.applyPptxChapterChartType(plan, "用户画像", "pie", true);
assert.equal(result.updated, 2);
assert.equal(result.preserved, 0);
assert.equal(plan.pages[1].chart_type, "pie");
assert.equal(plan.pages[1].chart_type_source, "chapter");

result = context.applyPptxChapterChartType(plan, "用户画像", "auto", false);
assert.equal(result.updated, 2);
assert.equal(plan.pages[0].chart_type_source, "");
assert.equal(plan.pages[1].chart_type_source, "");
result = context.applyPptxChapterChartType(plan, "用户画像", "auto", false);
assert.equal(result.updated, 0, "Reapplying the same chapter strategy must be a no-op.");

assert.match(source, /data-field="chapter_chart_type"/);
assert.match(source, /data-chapter-chart-overwrite/);
assert.match(source, /覆盖单页设置/);
console.log("PPT chapter chart strategy smoke passed.");
