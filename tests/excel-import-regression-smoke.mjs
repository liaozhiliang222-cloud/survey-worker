import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const converterDefinitions = source.match(/async function xlsxToDelimitedTableText\s*\(/g) || [];
assert.equal(
  converterDefinitions.length,
  1,
  "xlsxToDelimitedTableText must have a single implementation so a partial duplicate cannot override it"
);

assert.doesNotMatch(source, /function detectAiReportFields\(/, "Retired importer must not overwrite the crosstab context");
console.log("Excel import regression smoke passed: single XLSX converter, retired report importer removed");
