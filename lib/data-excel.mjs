import { qualitativeExcelInternals } from "./qualitative-excel.mjs";

const { writeZip } = qualitativeExcelInternals;

function xml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function columnName(index) {
  let value = index + 1; let output = "";
  while (value > 0) { const offset = (value - 1) % 26; output = String.fromCharCode(65 + offset) + output; value = Math.floor((value - 1) / 26); }
  return output;
}

function safeSheetName(value, fallback) {
  return String(value || fallback).replace(/[\\/*?:[\]]/g, "_").slice(0, 31) || fallback;
}

function worksheet(rows) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

function analysisRows(item) {
  const heading = [["变量", item.variable], ["Banner", item.banner], ["指标", item.metric], ["样本基数", item.base], []];
  if (["nps", "mean"].includes(item.metric)) return [...heading, ["细分", "数值", "Base", "较总体差异", "显著", "说明"], ...(item.groups || []).map((group) => [group.segment, group.value, group.base, group.delta_vs_total, Boolean(group.significant), group.significance_note || ""] )];
  const groups = item.categories?.[0]?.groups?.map((group) => group.segment) || [];
  return [...heading, ["选项", ...groups.flatMap((group) => [`${group} 数值`, `${group} Base`]), "显著比较"], ...(item.categories || []).map((category) => [category.category, ...groups.flatMap((group) => { const cell = category.groups.find((candidate) => candidate.segment === group) || {}; return [cell.percent ?? cell.weighted_percent ?? "", cell.base ?? cell.raw_base ?? ""]; }), (category.comparisons || []).map((comparison) => `${comparison.col1Label} vs ${comparison.col2Label}`).join("；")])];
}

export function buildCrosstabWorkbook(result) {
  const sheets = [{ name: "分析摘要", rows: [
    ["SurveyKit Crosstab Analysis Result"],
    ["Dataset ID", result.dataset_id],
    ["是否加权", Boolean(result.weighted)],
    ["Banner", (result.banners || []).join("、")],
    ["分析变量", (result.variables || []).join("、")],
    ["分析数量", (result.results || []).length],
  ] }];
  (result.results || []).forEach((item, index) => sheets.push({ name: safeSheetName(`${index + 1}_${item.variable}_${item.banner}`, `分析${index + 1}`), rows: analysisRows(item) }));
  const files = new Map();
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xml(safeSheetName(sheet.name, `Sheet${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  files.set("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`);
  files.set("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files.set("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`);
  files.set("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
  sheets.forEach((sheet, index) => files.set(`xl/worksheets/sheet${index + 1}.xml`, worksheet(sheet.rows)));
  return writeZip(files);
}
