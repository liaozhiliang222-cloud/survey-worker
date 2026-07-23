import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const template = readFileSync(new URL("../templates/crosstab/crosstab-header-template.xlsx", import.meta.url));

function uint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function zipEntry(bytes, entryName) {
  for (let offset = 0; offset < bytes.length - 46; offset += 1) {
    if (uint32(bytes, offset) !== 0x02014b50) continue;
    const compression = uint16(bytes, offset + 10);
    const compressedSize = uint32(bytes, offset + 20);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const commentLength = uint16(bytes, offset + 32);
    const localOffset = uint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (name === entryName) {
      const localNameLength = uint16(bytes, localOffset + 26);
      const localExtraLength = uint16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      return (compression === 8 ? inflateRawSync(compressed) : compressed).toString("utf8");
    }
    offset = nameStart + nameLength + extraLength + commentLength - 1;
  }
  return "";
}

assert.match(
  html,
  /id="downloadCrosstabHeaderTemplate"[\s\S]{0,180}href="\.\/templates\/crosstab\/crosstab-header-template\.xlsx"[\s\S]{0,120}download="交叉表表头模板\.xlsx"/,
);
assert.match(styles, /\.download-template-btn\s*\{[\s\S]{0,180}text-decoration:\s*none/);
assert.match(serviceWorker, /research-toolbox-v49/);
assert.match(serviceWorker, /\.\/templates\/crosstab\/crosstab-header-template\.xlsx/);
assert.match(source, /<\(\?:\\w\+:\)\?row\\b/);
assert.equal(template.subarray(0, 2).toString("utf8"), "PK");

const workbookXml = zipEntry(template, "xl/workbook.xml");

const firstSheetXml = zipEntry(template, "xl/worksheets/sheet1.xml");

assert.match(workbookXml, /name="表头模板"/);
assert.match(workbookXml, /name="填写说明"/);
assert.match(firstSheetXml, /r="A1"/);
assert.match(firstSheetXml, /r="I3"/);
["总体", "性别", "年龄", "城市级别", "S1=1", "S2=2", "S3=3"].forEach((text) => {
  assert.ok(firstSheetXml.includes(text), `template should contain ${text}`);
});

console.log("Crosstab header template smoke passed: download entry, valid XLSX, three-row banner examples");