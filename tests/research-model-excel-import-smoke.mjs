import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = app.indexOf("function worksheetByName");
const end = app.indexOf("async function handleResearchModelExcelImport", start);
assert.ok(start >= 0 && end > start, "KANO workbook helpers must exist");
const context = vm.createContext({ console });
vm.runInContext(`${app.slice(start, end)}\nthis.classifyKanoPair = classifyKanoPair; this.kanoSummaryFromRawWorkbook = kanoSummaryFromRawWorkbook;`, context);

assert.equal(context.classifyKanoPair(5, 1), "O");
assert.equal(context.classifyKanoPair(5, 2), "A");
assert.equal(context.classifyKanoPair(4, 1), "M");
assert.equal(context.classifyKanoPair(3, 3), "I");
assert.equal(context.classifyKanoPair(1, 5), "R");
assert.equal(context.classifyKanoPair(5, 5), "Q");
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
  id: "1", name: "功能一", A: 1, O: 1, M: 1, I: 1, R: 1, Q: 1
});
assert.equal(summary[1].O, 1);
assert.equal(summary[1].A + summary[1].M + summary[1].I + summary[1].R + summary[1].Q, 0);

for (const name of ["psm", "kano", "maxdiff", "driver", "turf", "conjoint"]) {
  const file = path.join(root, "templates", "research-models", `${name}-template.xlsx`);
  assert.ok(fs.existsSync(file), `${name} template must exist`);
  assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), "PK");
}

console.log("research model Excel import and raw KANO smoke: ok");