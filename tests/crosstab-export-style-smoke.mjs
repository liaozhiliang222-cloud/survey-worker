import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const exportSource = readFileSync(new URL("../src/shared/export.js", import.meta.url), "utf8");
const exportModule = await import(`data:text/javascript;base64,${Buffer.from(exportSource).toString("base64")}`);
const { buildExcelWorkbookXml } = exportModule;

const xml = buildExcelWorkbookXml([
  {
    name: "目录",
    kind: "directory",
    columnCount: 5,
    showGridlines: false,
    rows: [
      { height: 30, cells: [{ value: "交叉表目录", format: "directoryTitle", mergeAcross: 4 }] },
      { cells: [{ value: "题目", format: "directoryHeader" }, { value: "查看", format: "directoryLink" }] }
    ]
  },
  {
    name: "频数",
    kind: "crosstab",
    columnCount: 5,
    showGridlines: false,
    rows: [
      { height: 25, cells: [{ value: "CAPTION:1. 城市级别", format: "crosstabCaption", mergeAcross: 4 }] },
      { height: 20, cells: [{ value: "", format: "crosstabHeaderTop", mergeAcross: 1 }, { value: "整体", format: "crosstabHeaderTop", mergeAcross: 2 }] },
      { cells: [{ value: "BASE", format: "crosstabBase", mergeAcross: 1 }, { value: 100, type: "number", format: "crosstabBase" }] }
    ]
  }
]);

assert.match(xml, /ss:ID="CrosstabCaption"/);
assert.match(xml, /ss:ID="CrosstabHeaderTop"/);
assert.match(xml, /ss:ID="CrosstabBase"/);
assert.match(xml, /ss:ID="DirectoryTitle"/);
assert.match(xml, /ss:StyleID="CrosstabCaption" ss:MergeAcross="4"/);
assert.match(xml, /ss:StyleID="CrosstabHeaderTop" ss:MergeAcross="2"/);
assert.match(xml, /ss:StyleID="CrosstabBase" ss:MergeAcross="1"/);
assert.match(xml, /ss:Width="92"/);
assert.match(xml, /ss:Width="58" ss:Span="2"/);
assert.match(xml, /<DoNotDisplayGridlines\/>/);

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
assert.match(appSource, /function appendCrosstabWorkbookBlock\(/);
assert.match(appSource, /format: "crosstabCaption", mergeAcross: totalColumns - 1/);
assert.match(appSource, /mergedCrosstabHeaderCells\(groups, "crosstabHeaderTop"\)/);
assert.match(appSource, /kind: "directory", columnCount: 5/);
assert.match(appSource, /kind: "crosstab", columnCount: countSheet\.columnCount/);

console.log("crosstab export style smoke passed");
