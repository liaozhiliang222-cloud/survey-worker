import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const converterDefinitions = source.match(/async function xlsxToDelimitedTableText\s*\(/g) || [];
assert.equal(
  converterDefinitions.length,
  1,
  "xlsxToDelimitedTableText must have a single implementation so a partial duplicate cannot override it"
);

const detectorStart = source.indexOf("function detectAiReportFields()");
const detectorEnd = source.indexOf("const exampleAiReportData", detectorStart);
assert.ok(detectorStart >= 0 && detectorEnd > detectorStart, "detectAiReportFields body should be present");
const detector = source.slice(detectorStart, detectorEnd);
assert.match(detector, /const rawText = document\.querySelector\("#aiReportData"\)\.value/);
assert.match(detector, /parseDelimitedTable\(rawText\)/);
assert.doesNotMatch(detector, /return sheets/);

console.log("Excel import regression smoke passed: one XLSX converter and scoped rawText detection");
