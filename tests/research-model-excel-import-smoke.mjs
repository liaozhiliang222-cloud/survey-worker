import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = app.indexOf("function worksheetByName");
const end = app.indexOf("async function handleResearchModelExcelImport", start);
const csvLineStart = app.indexOf("function parseCsvLine");
const csvLineEnd = app.indexOf("function decodeXmlText", csvLineStart);
const csvCellStart = app.indexOf("function csvCell");
const csvCellEnd = app.indexOf("function downloadCsv", csvCellStart);
const kanoRowsStart = app.indexOf("function parseKanoRows");
const kanoRowsEnd = app.indexOf("function analyzeKanoRow", kanoRowsStart);
assert.ok(start >= 0 && end > start, "KANO workbook helpers must exist");
const context = vm.createContext({ console });
vm.runInContext(`${app.slice(csvLineStart, csvLineEnd)}\n${app.slice(csvCellStart, csvCellEnd)}\n${app.slice(start, end)}\n${app.slice(kanoRowsStart, kanoRowsEnd)}\nthis.classifyKanoPair = classifyKanoPair; this.kanoSummaryFromRawWorkbook = kanoSummaryFromRawWorkbook; this.rowsToCsvText = rowsToCsvText; this.parseKanoRows = parseKanoRows;`, context);

assert.equal(context.classifyKanoPair(1, 5), "O");
assert.equal(context.classifyKanoPair(1, 4), "A");
assert.equal(context.classifyKanoPair(2, 5), "M");
assert.equal(context.classifyKanoPair(3, 3), "I");
assert.equal(context.classifyKanoPair(5, 1), "R");
assert.equal(context.classifyKanoPair(1, 1), "Q");
assert.equal(context.classifyKanoPair(5, 1, true), "O");
assert.equal(context.classifyKanoPair("", 1), null);

const sheets = [
  { name: "data", rows: [
    ["rid", "A1__1", "A1__2", "A2__1", "A2__2"],
    ["R1", 5, 1, 5, 1], ["R2", 5, 2, "", ""], ["R3", 4, 1, null, null],
    ["R4", 3, 3, null, null], ["R5", 1, 5, null, null], ["R6", 5, 5, null, null]
  ]},
  { name: "code", rows: [
    ["7", "A1. A1.功能一【每行单选】"], ["8", "A2. A2.功能二【每行单选】"]
  ]}
];
const summary = context.kanoSummaryFromRawWorkbook(sheets);
assert.equal(summary.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(summary[0])), {
  id: "A1", name: "功能一", A: 1, O: 1, M: 1, I: 1, R: 1, Q: 1
});
assert.equal(summary[1].O, 1);
assert.equal(summary[1].A + summary[1].M + summary[1].I + summary[1].R + summary[1].Q, 0);
const surveyExport = [
  { name: "data", rows: [
    ["rid", "Q76_1_1", "Q76_1__2", "Q76_2__1", "Q76_2__2"],
    ["R001", 1, 5, 2, 5],
    ["R002", 1, 4, 3, 5]
  ]},
  { name: "features", rows: [
    ["feature_id", "feature_name"],
    ["Q76_1", "池底、池壁、水线清洁"],
    ["Q76_2", "晒台清洁"]
  ]}
];
const surveySummary = context.kanoSummaryFromRawWorkbook(surveyExport);
assert.equal(surveySummary.length, 2);
assert.equal(surveySummary[0].id, "Q76_1");
assert.equal(surveySummary[0].name, "池底、池壁、水线清洁");
assert.equal(surveySummary[1].name, "晒台清洁");
assert.equal(surveySummary[0].O, 1);
assert.equal(surveySummary[0].A, 1);
assert.equal(surveySummary[0].R, 0);
assert.equal(surveySummary[1].M, 2);
assert.equal(surveySummary[0].A + surveySummary[0].O + surveySummary[0].M + surveySummary[0].I + surveySummary[0].R + surveySummary[0].Q, 2);
const commaRows = [
  ["池底，池壁，水线清洁", 1, 2, 3, 4, 5, 6],
  ["外观设计,精致\"高级\"", 6, 5, 4, 3, 2, 1]
];
const encodedRows = context.rowsToCsvText(commaRows);
const parsedCommaRows = context.parseKanoRows(encodedRows);
assert.equal(parsedCommaRows.length, 2);
assert.equal(parsedCommaRows[0].name, commaRows[0][0]);
assert.equal(parsedCommaRows[1].name, commaRows[1][0]);
assert.equal(parsedCommaRows[1].questionable, 1);
const legacyCommaRow = context.parseKanoRows("池底，池壁，水线清洁,1,2,3,4,5,6");
assert.equal(legacyCommaRow.length, 1);
assert.equal(legacyCommaRow[0].name, "池底，池壁，水线清洁");

for (const name of ["psm", "kano", "maxdiff", "driver", "turf", "conjoint"]) {
  const file = path.join(root, "templates", "research-models", `${name}-template.xlsx`);
  assert.ok(fs.existsSync(file), `${name} template must exist`);
  assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), "PK");
}

console.log("research model Excel import and raw KANO smoke: ok");