import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const exportSource = readFileSync(new URL("../src/shared/export.js", import.meta.url), "utf8");
const exportModule = await import(`data:text/javascript;base64,${Buffer.from(exportSource).toString("base64")}`);
const { buildExcelWorkbookXml, buildExcelWorkbookXlsxBytes } = exportModule;

function zipEntry(bytes, entryName) {
  let index = 0;
  while (index + 30 <= bytes.length) {
    const signature = bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24);
    if ((signature >>> 0) !== 0x04034b50) break;
    const compression = bytes[index + 8] | (bytes[index + 9] << 8);
    const compressedSize = bytes[index + 18] | (bytes[index + 19] << 8) | (bytes[index + 20] << 16) | (bytes[index + 21] << 24);
    const fileNameLength = bytes[index + 26] | (bytes[index + 27] << 8);
    const extraLength = bytes[index + 28] | (bytes[index + 29] << 8);
    const nameStart = index + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + fileNameLength));
    if (name === entryName) {
      assert.equal(compression, 0, `${entryName} should use stored ZIP data in the browser exporter`);
      return new TextDecoder().decode(bytes.slice(dataStart, dataStart + compressedSize));
    }
    index = dataStart + compressedSize;
  }
  return "";
}

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
assert.match(appSource, /buildExcelWorkbookXlsxBytes/);
assert.match(appSource, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);

const xlsxBytes = buildExcelWorkbookXlsxBytes([
  {
    name: "目录",
    kind: "directory",
    columnCount: 5,
    showGridlines: false,
    rows: [
      { height: 30, cells: [{ value: "交叉表目录", format: "directoryTitle", mergeAcross: 4 }] },
      { cells: [{ value: "频数", href: "#'频数'!A1", format: "directoryLink" }] }
    ]
  },
  {
    name: "频数",
    kind: "crosstab",
    columnCount: 5,
    showGridlines: false,
    rows: [
      { height: 25, cells: [{ value: "CAPTION:1. 城市级别", format: "crosstabCaption", mergeAcross: 4 }] },
      { cells: [{ value: "选项", format: "crosstabHeaderTop", mergeAcross: 1 }, { value: "整体", format: "crosstabHeaderTop", mergeAcross: 2 }] },
      { cells: [{ value: "BASE", format: "crosstabBase", mergeAcross: 1 }, { value: 100, type: "number", format: "crosstabBase" }] },
      { cells: [{ value: "一线城市", format: "crosstabRowLabel", mergeAcross: 1 }, { value: 0.35, type: "number", format: "percent" }] }
    ]
  }
]);
assert.equal(xlsxBytes[0], 0x50);
assert.equal(xlsxBytes[1], 0x4b);
const workbookXml = zipEntry(xlsxBytes, "xl/workbook.xml");
const directoryXml = zipEntry(xlsxBytes, "xl/worksheets/sheet1.xml");
const crosstabXml = zipEntry(xlsxBytes, "xl/worksheets/sheet2.xml");
const stylesXml = zipEntry(xlsxBytes, "xl/styles.xml");
assert.match(workbookXml, /sheet name="目录"/);
assert.match(workbookXml, /sheet name="频数"/);
assert.match(directoryXml, /mergeCell ref="A1:E1"/);
assert.match(directoryXml, /location="'频数'!A1"/);
assert.match(crosstabXml, /mergeCell ref="A1:E1"/);
assert.match(crosstabXml, /showGridLines="0"/);
assert.match(crosstabXml, /<c r="C4" s="1"><v>0\.35<\/v><\/c>/);
assert.match(stylesXml, /numFmtId="164" formatCode="0\.0%"/);

const parserSource = readFileSync(new URL("../src/shared/file-parser.js", import.meta.url), "utf8");
const parserModule = await import(`data:text/javascript;base64,${Buffer.from(parserSource).toString("base64")}`);
const inspection = await parserModule.inspectResearchWorkbook(xlsxBytes.buffer, { target: "pptx_crosstab" });
assert.equal(inspection.format, "standard_crosstab");
assert.equal(inspection.metrics.sheet_count, 2);
assert.ok(inspection.metrics.question_count >= 1);
assert.deepEqual(inspection.sheets.map((sheet) => sheet.name), ["目录", "频数"]);
assert.match(inspection.sheets[1].preview.flat().join(" "), /城市级别|一线城市/);
assert.notEqual(inspection.status, "error");

const variantBytes = buildExcelWorkbookXlsxBytes([
  {
    name: "Data_A",
    kind: "crosstab",
    columnCount: 6,
    rows: [
      { cells: [{ value: "CAPTION：[Q9]。购买意愿", mergeAcross: 5 }] },
      { cells: [{ value: "", mergeAcross: 2 }, { value: "全体" }, { value: "购买人群" }] },
      { cells: [{ value: "", mergeAcross: 2 }, { value: "全部" }, { value: "女性" }] },
      { cells: [{ value: "有效样本量", mergeAcross: 2 }, { value: 100, type: "number" }, { value: 40, type: "number" }] },
      { cells: [{ value: "愿意", mergeAcross: 2 }, { value: "60%" }, { value: "75%" }] },
    ],
  },
]);
const variantInspection = await parserModule.inspectResearchWorkbook(
  variantBytes.buffer,
  { target: "pptx_crosstab" },
);
assert.equal(variantInspection.format, "standard_crosstab");
assert.equal(variantInspection.selected_sheet, "Data_A");
assert.equal(variantInspection.metrics.question_count, 1);
assert.notEqual(variantInspection.status, "error");

console.log("crosstab export style smoke passed");
