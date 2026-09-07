/**
 * 文件解析工具 — CSV / DOCX / XLSX / SAV 纯解析函数
 * 无 DOM 依赖（除 DecompressionStream 需要浏览器环境）
 */

// ─── 基础工具 ───────────────────────────────────────────────

export function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === "，") && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function splitDelimitedLine(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parseDelimitedTable(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitDelimitedLine(lines[0]).map((header, index) => header || `字段${index + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });
  return { headers, rows };
}

export function decodeXmlText(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function normalizeImportedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// ─── ZIP 解析 ───────────────────────────────────────────────

export function uint8ToString(bytes) {
  let result = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return result;
}

function zipUint16(bytes, index) {
  return bytes[index] | (bytes[index + 1] << 8);
}

function zipUint32(bytes, index) {
  return (bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24)) >>> 0;
}

function findZipEntryInCentralDirectory(bytes, entryName) {
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < bytes.length - 46; index += 1) {
    if (bytes[index] !== 0x50 || bytes[index + 1] !== 0x4b || bytes[index + 2] !== 0x01 || bytes[index + 3] !== 0x02) continue;
    const compression = zipUint16(bytes, index + 10);
    const compressedSize = zipUint32(bytes, index + 20);
    const fileNameLength = zipUint16(bytes, index + 28);
    const extraLength = zipUint16(bytes, index + 30);
    const commentLength = zipUint16(bytes, index + 32);
    const localHeaderOffset = zipUint32(bytes, index + 42);
    const nameStart = index + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));
    if (name === entryName) {
      const localFileNameLength = zipUint16(bytes, localHeaderOffset + 26);
      const localExtraLength = zipUint16(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      return { compression, data: bytes.subarray(dataStart, dataStart + compressedSize) };
    }
    index = nameStart + fileNameLength + extraLength + commentLength - 1;
  }
  return null;
}

function findZipEntry(bytes, entryName) {
  const centralEntry = findZipEntryInCentralDirectory(bytes, entryName);
  if (centralEntry) return centralEntry;
  const nameBytes = new TextEncoder().encode(entryName);
  for (let index = 0; index < bytes.length - 30; index += 1) {
    if (bytes[index] !== 0x50 || bytes[index + 1] !== 0x4b || bytes[index + 2] !== 0x03 || bytes[index + 3] !== 0x04) continue;
    const compression = zipUint16(bytes, index + 8);
    const compressedSize = zipUint32(bytes, index + 18);
    const fileNameLength = zipUint16(bytes, index + 26);
    const extraLength = zipUint16(bytes, index + 28);
    const nameStart = index + 30;
    const name = bytes.subarray(nameStart, nameStart + fileNameLength);
    const dataStart = nameStart + fileNameLength + extraLength;
    const matched = name.length === nameBytes.length && name.every((byte, byteIndex) => byte === nameBytes[byteIndex]);
    if (matched) {
      return { compression, data: bytes.subarray(dataStart, dataStart + compressedSize) };
    }
    index = dataStart + Math.max(0, compressedSize) - 1;
  }
  return null;
}

export async function readZipText(arrayBuffer, entryName) {
  const entry = findZipEntry(new Uint8Array(arrayBuffer), entryName);
  if (!entry) return "";
  if (entry.compression === 0) return new TextDecoder("utf-8").decode(entry.data);
  if (entry.compression === 8 && "DecompressionStream" in globalThis) {
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }
  throw new Error("当前浏览器不支持解析该压缩格式，请尝试另存为 TXT 或 CSV 后导入。");
}

// ─── DOCX 解析 ──────────────────────────────────────────────

export function docxXmlToText(xml) {
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)]
    .map((match) => {
      const paragraph = match[0]
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>/g, "\n");
      return [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((textMatch) => decodeXmlText(textMatch[1]))
        .join("");
    })
    .map((line) => line.trim())
    .filter(Boolean);
  return normalizeImportedText(paragraphs.join("\n"));
}

export async function docxToQuestionnaireText(arrayBuffer) {
  const xml = await readZipText(arrayBuffer, "word/document.xml");
  if (!xml) throw new Error("未识别到 DOCX 正文内容。");
  return docxXmlToText(xml);
}

export function docxParagraphXmlToText(paragraphXml) {
  const content = String(paragraphXml || "").replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/g, "");
  return [...content.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g)]
    .map((match) => match[1] !== undefined
      ? decodeXmlText(match[1])
      : /^<w:tab\b/.test(match[0]) ? "\t" : "\n")
    .join("")
    .trim();
}

export function docxTableXmlToMarkdown(tableXml) {
  const rows = [...String(tableXml || "").matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .map((rowMatch) => [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
      .map((cellMatch) => [...cellMatch[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .map((paragraphMatch) => docxParagraphXmlToText(paragraphMatch[0]))
        .filter(Boolean)
        .join(" / ")
        .replace(/\|/g, "\\|")
        .trim()))
    .filter((row) => row.some(Boolean));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
  return [
    `| ${normalizedRows[0].join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

export function normalizeTemplateText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function docxXmlToStructuredTemplateText(xml) {
  const body = String(xml || "").match(/<w:body\b[\s\S]*?<\/w:body>/)?.[0] || String(xml || "");
  const blocks = [];
  for (const match of body.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)) {
    if (match[1] === "tbl") {
      const table = docxTableXmlToMarkdown(match[0]);
      if (table) blocks.push(table);
      continue;
    }
    const text = docxParagraphXmlToText(match[0]);
    if (!text) continue;
    const style = match[0].match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || "";
    const isList = /<w:numPr\b/.test(match[0]);
    const isHeading1 = /(?:Heading1|标题 ?1|Title)/i.test(style) || /^[一二三四五六七八九十]+[、.．]\s*/.test(text);
    const isHeading2 = /(?:Heading2|标题 ?2)/i.test(style) || /^\d+(?:\.\d+)+[、.．\s]/.test(text);
    blocks.push(isHeading1 ? `## ${text}` : isHeading2 ? `### ${text}` : isList ? `- ${text}` : text);
  }
  return normalizeTemplateText(blocks.join("\n\n"));
}

export async function docxToAiPlanTemplateText(arrayBuffer) {
  const xml = await readZipText(arrayBuffer, "word/document.xml");
  if (!xml) throw new Error("未识别到 DOCX 正文内容。");
  return docxXmlToStructuredTemplateText(xml);
}

export function legacyDocUnsupportedMessage(filename = "该文件") {
  return `${filename} 是旧版 .doc 格式，浏览器端无法稳定解析，直接读取会产生乱码。请先用 Word/WPS/LibreOffice 另存为 .docx 后再导入。`;
}

// ─── XLSX 解析 ──────────────────────────────────────────────

export function sharedStringsFromXml(xml) {
  return [...xml.matchAll(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g)].map((match) =>
    [...match[0].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((textMatch) => decodeXmlText(textMatch[1])).join("")
  );
}

export function columnIndexFromRef(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  return letters.toUpperCase().split("").reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function xlsxSheetXmlToRows(xml, sharedStrings) {
  return [...xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map((rowMatch) => {
    const row = [];
    [...rowMatch[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)].forEach((cellMatch, fallbackIndex) => {
      const attrs = cellMatch[1];
      const body = cellMatch[2] || "";
      const ref = attrs.match(/r="([^"]+)"/)?.[1] || "";
      const columnIndex = Math.max(0, columnIndexFromRef(ref));
      const value = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] || "";
      const inline = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((textMatch) => decodeXmlText(textMatch[1])).join("");
      const cellValue = /t="s"/.test(attrs) ? sharedStrings[Number(value)] || "" : decodeXmlText(inline || value);
      row[Number.isFinite(columnIndex) ? columnIndex : fallbackIndex] = cellValue;
    });
    return Array.from({ length: row.length }, (_, index) => row[index] ?? "");
  }).filter((row) => row.some(Boolean));
}

export function getWorkbookSheetPaths(workbookXml, relationshipXml = "") {
  const sheetIds = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*r:id="([^"]+)"/g)].map((match) => match[1]);
  const relationshipMap = new Map(
    [...relationshipXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((match) => [match[1], match[2].startsWith("/") ? match[2].slice(1) : `xl/${match[2]}`])
  );
  if (!sheetIds.length) return ["xl/worksheets/sheet1.xml"];
  return sheetIds.map((sheetId, index) => {
    if (relationshipMap.has(sheetId)) return relationshipMap.get(sheetId);
    const number = sheetId.match(/\d+/)?.[0] || String(index + 1);
    return `xl/worksheets/sheet${number}.xml`;
  });
}

export function getWorkbookSheets(workbookXml, relationshipXml = "") {
  const relationshipMap = new Map(
    [...relationshipXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((match) => [match[1], match[2].startsWith("/") ? match[2].slice(1) : `xl/${match[2]}`])
  );
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((match, index) => {
    const attrs = match[1] || "";
    const id = attrs.match(/r:id="([^"]+)"/)?.[1] || "";
    const name = decodeXmlText(attrs.match(/name="([^"]+)"/)?.[1] || `Sheet${index + 1}`);
    const target = relationshipMap.get(id);
    const path = target || `xl/worksheets/sheet${index + 1}.xml`;
    return { index, name, path };
  });
  return sheets.length ? sheets : getWorkbookSheetPaths(workbookXml, relationshipXml).map((path, index) => ({ index, name: `Sheet${index + 1}`, path }));
}

export function getWorkbookSheetNames(workbookXml) {
  return [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"/g)].map((m) => decodeXmlText(m[1]));
}

// ─── 统一工作簿识别与诊断 ────────────────────────────────────

export const IMPORT_FORMATS = Object.freeze({
  STANDARD_CROSSTAB: "standard_crosstab",
  FLAT_CROSSTAB: "flat_crosstab",
  RAW_SURVEY: "raw_survey",
  KANO: "kano",
  DATA_CODE: "data_code",
  UNKNOWN: "unknown",
});

export const IMPORT_FORMAT_LABELS = Object.freeze({
  [IMPORT_FORMATS.STANDARD_CROSSTAB]: "标准交叉表",
  [IMPORT_FORMATS.FLAT_CROSSTAB]: "平铺交叉表",
  [IMPORT_FORMATS.RAW_SURVEY]: "原始问卷数据",
  [IMPORT_FORMATS.KANO]: "KANO 正反向题数据",
  [IMPORT_FORMATS.DATA_CODE]: "data + code 双 Sheet 数据",
  [IMPORT_FORMATS.UNKNOWN]: "未识别结构",
});

function normalizedCell(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function isTotalLabel(value) {
  return /^(?:total|grand\s*total|all|总体|整体|总计|合计|全体|全部)$/i.test(normalizedCell(value));
}

function isBaseLabel(value) {
  return /^(?:base|valid\s*n|sample\s*size|n|有效样本量?|样本量|样本数)$/i.test(normalizedCell(value));
}

function hasCaptionMarker(value) {
  return /^caption\s*[:：]/i.test(normalizedCell(value));
}

function normalizedRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row.map(normalizedCell) : []))
    .filter((row) => row.some(Boolean));
}

function workbookWidth(rows) {
  return rows.reduce((width, row) => Math.max(width, row.length), 0);
}

function nonEmptyCount(row) {
  return (row || []).filter((cell) => normalizedCell(cell)).length;
}

function sheetContains(sheet, pattern) {
  return sheet.rows.some((row) => row.some((cell) => pattern.test(normalizedCell(cell))));
}

function looksLikeQuestionCode(value) {
  return /^(?:Q|S|A|B|C|D|E|F|G|H|K|M|N|P|R|V)\d+(?:[_-]\d+)*(?:\.|\s|$)/i.test(normalizedCell(value));
}

function normalizeKanoFeatureCode(value) {
  const match = normalizedCell(value).match(/^(.+?)_{1,2}([12])$/);
  return match ? match[1].replace(/_+$/, "") : "";
}

function kanoFeatureCodes(headers) {
  const counts = new Map();
  headers.slice(1).forEach((header) => {
    const code = normalizeKanoFeatureCode(header);
    if (!code) return;
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([code]) => code);
}

function findHeaderRow(sheet) {
  const candidates = sheet.rows.slice(0, 20).map((row, index) => ({
    index,
    row,
    populated: nonEmptyCount(row),
    score: nonEmptyCount(row)
      + (row.some((cell) => /题目|选项|变量|字段|total|总体|总计|合计|rid|id/i.test(normalizedCell(cell))) ? 8 : 0),
  }));
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0] || { index: 0, row: [] };
}

function analyzeSheet(sheet) {
  const rows = normalizedRows(sheet.rows);
  const width = workbookWidth(rows);
  const headerInfo = findHeaderRow({ rows });
  const header = headerInfo.row.map(normalizedCell);
  const name = normalizedCell(sheet.name) || `Sheet${Number(sheet.index || 0) + 1}`;
  const codeMarker = /^(?:本题选项|选项编码|变量编码|value labels?)/i;
  const isInstruction = /说明|instruction|readme|guide/i.test(name);
  const isCode = /^(?:code|codes|codebook|features?)$/i.test(name)
    || /编码|码表|题目字典|变量标签|功能项/i.test(name)
    || rows.slice(0, 60).some((row) => row.some((cell) => codeMarker.test(normalizedCell(cell))));
  const hasCaption = sheetContains({ rows }, /CAPTION\s*[:：]/i);
  const pairedKanoCodes = kanoFeatureCodes(header);
  const isData = !isInstruction && rows.length >= 2 && width >= 2;
  return {
    index: Number(sheet.index || 0),
    name,
    rows,
    row_count: rows.length,
    column_count: width,
    header_row_index: headerInfo.index,
    headers: header,
    preview: rows.slice(0, 5).map((row) => row.slice(0, 8)),
    flags: { is_instruction: isInstruction, is_code: isCode, is_data: isData, has_caption: hasCaption },
    kano_feature_codes: pairedKanoCodes,
  };
}

function countStandardCrosstabQuestions(sheets) {
  const questions = new Set();
  sheets.forEach((sheet) => sheet.rows.forEach((row) => row.forEach((cell) => {
    const match = normalizedCell(cell).match(/CAPTION\s*[:：]\s*(.+)/i);
    if (match) questions.add(match[1].replace(/^\[[^\]]+\]\s*[.．]?\s*/, "").trim());
  })));
  return questions.size;
}

function standardCrosstabSheetScore(sheet) {
  const name = normalizedCell(sheet.name);
  let score = 0;
  if (/目录|索引|说明|index|toc|readme/i.test(name)) score -= 100;
  if (/%|百分比|percent|percentage|table\s*\(%\)/i.test(name)) score += 40;
  if (/频数|count|frequency/i.test(name)) score += 10;
  sheet.rows.slice(0, 250).forEach((row) => {
    if (row.some(hasCaptionMarker)) score += 6;
    if (row.some(isTotalLabel)) score += 3;
    if (row.slice(0, 3).some(isBaseLabel)) score += 3;
    if (row.some((cell) => /^(?:百分比|列\s*n?\s*%|column\s*n?\s*%|percent(?:age)?)$/i.test(normalizedCell(cell)))) score += 8;
  });
  return score;
}

function standardCrosstabDimensions(sheets) {
  const dimensions = new Set();
  sheets.filter((sheet) => sheet.flags.has_caption).forEach((sheet) => {
    const baseIndex = sheet.rows.findIndex((row) => row.slice(0, 3).some(isBaseLabel));
    if (baseIndex < 1) return;
    const leaf = sheet.rows[baseIndex - 1] || [];
    const parent = sheet.rows[baseIndex - 2] || [];
    let activeParent = "";
    for (let column = 1; column < Math.max(leaf.length, parent.length); column += 1) {
      const parentValue = normalizedCell(parent[column]);
      if (parentValue) activeParent = parentValue;
      const leafValue = normalizedCell(leaf[column]);
      if (activeParent && leafValue && !isTotalLabel(activeParent)) dimensions.add(activeParent);
    }
  });
  return [...dimensions];
}

function flatCrosstabInfo(sheets) {
  let questionCount = 0;
  const dimensions = new Set();
  sheets.forEach((sheet) => {
    const headerIndex = sheet.rows.findIndex((row) =>
      /题目|选项|指标|question/i.test(normalizedCell(row[0]))
      && row.slice(1).some(isTotalLabel)
    );
    if (headerIndex < 0) return;
    const headers = sheet.rows[headerIndex] || [];
    headers.slice(1).forEach((header) => {
      const text = normalizedCell(header);
      if (!text || isTotalLabel(text)) return;
      const group = text.split(/[-_／/]/)[0].trim();
      if (group) dimensions.add(group);
    });
    sheet.rows.slice(headerIndex + 1).forEach((row) => {
      const first = normalizedCell(row[0]);
      if (!looksLikeQuestionCode(first)) return;
      const numericCells = row.slice(1).filter((cell) => normalizedCell(cell) !== "");
      if (numericCells.length <= 1) questionCount += 1;
    });
  });
  return { question_count: questionCount, dimensions: [...dimensions] };
}

function rawSurveyQuestionHeaders(headers) {
  const idPattern = /^(?:id|rid|respondent|record|序号|编号|样本编号|答卷编号)$/i;
  return headers.filter((header) => header && !idPattern.test(header));
}

function rawSurveyDimensions(headers) {
  const dimensionPattern = /性别|年龄|地区|省份|城市|收入|职业|学历|婚姻|家庭|人群|分群|cluster|segment|gender|age|region|city|income/i;
  return headers.filter((header) => dimensionPattern.test(header));
}

function diagnostic(severity, code, message, action = "", sheet = "") {
  return { severity, code, message, action, sheet };
}

export async function xlsxToWorkbookSheets(arrayBuffer) {
  const sharedXml = await readZipText(arrayBuffer, "xl/sharedStrings.xml").catch(() => "");
  const workbookXml = await readZipText(arrayBuffer, "xl/workbook.xml").catch(() => "");
  const relationshipXml = await readZipText(arrayBuffer, "xl/_rels/workbook.xml.rels").catch(() => "");
  if (!workbookXml) throw new Error("文件中缺少 Excel 工作簿结构（xl/workbook.xml），请确认文件未损坏并另存为 .xlsx。");
  const sharedStrings = sharedStringsFromXml(sharedXml);
  const sheets = getWorkbookSheets(workbookXml, relationshipXml);
  const parsedSheets = [];
  for (const sheet of sheets) {
    const sheetXml = await readZipText(arrayBuffer, sheet.path).catch(() => "");
    if (!sheetXml) continue;
    const rows = xlsxSheetXmlToRows(sheetXml, sharedStrings);
    if (rows.length) parsedSheets.push({ ...sheet, rows });
  }
  return parsedSheets;
}

/**
 * 统一识别 Excel 的业务结构。该函数只分类和诊断，不替代后端的精确交叉表计算。
 * @returns {Promise<object>} ImportInspection v1
 */
export async function inspectResearchWorkbook(arrayBuffer, options = {}) {
  const rawSheets = await xlsxToWorkbookSheets(arrayBuffer);
  const sheets = rawSheets.map(analyzeSheet);
  const diagnostics = [];
  const dataSheets = sheets.filter((sheet) => sheet.flags.is_data && !sheet.flags.is_code);
  const codeSheets = sheets.filter((sheet) => sheet.flags.is_code);
  const captionSheets = sheets.filter((sheet) => sheet.flags.has_caption);
  const kanoDataSheet = dataSheets.find((sheet) => sheet.kano_feature_codes.length >= 2);
  const flat = flatCrosstabInfo(sheets);
  let format = IMPORT_FORMATS.UNKNOWN;
  let questionCount = 0;
  let dimensions = [];
  let selectedSheet = dataSheets[0] || sheets[0] || null;

  if (!sheets.length) {
    diagnostics.push(diagnostic("error", "EMPTY_WORKBOOK", "工作簿中没有可读取的数据 Sheet。", "请删除空白 Sheet，并将数据放在至少包含表头和一行数据的 Sheet 中。"));
  } else if (captionSheets.length) {
    format = IMPORT_FORMATS.STANDARD_CROSSTAB;
    selectedSheet = [...captionSheets].sort(
      (left, right) => standardCrosstabSheetScore(right) - standardCrosstabSheetScore(left)
    )[0];
    questionCount = countStandardCrosstabQuestions(captionSheets);
    dimensions = standardCrosstabDimensions(captionSheets);
  } else if (flat.question_count > 0) {
    format = IMPORT_FORMATS.FLAT_CROSSTAB;
    selectedSheet = sheets.find((sheet) => sheet.rows.some((row) => /题目|选项|question/i.test(normalizedCell(row[0])))) || selectedSheet;
    questionCount = flat.question_count;
    dimensions = flat.dimensions;
  } else if (kanoDataSheet) {
    format = IMPORT_FORMATS.KANO;
    selectedSheet = kanoDataSheet;
    const featureSheet = codeSheets.find((sheet) => /feature|功能项/i.test(sheet.name));
    const featureRows = featureSheet?.rows.slice(1).filter((row) => normalizedCell(row[0])) || [];
    questionCount = Math.max(kanoDataSheet.kano_feature_codes.length, featureRows.length);
    dimensions = rawSurveyDimensions(kanoDataSheet.headers);
  } else if (dataSheets.length && codeSheets.length) {
    format = IMPORT_FORMATS.DATA_CODE;
    selectedSheet = dataSheets.sort((left, right) => right.row_count - left.row_count)[0];
    const codebook = Object.assign({}, ...codeSheets.map((sheet) => parseCodebookRows(sheet.rows)));
    questionCount = Object.keys(codebook).length || rawSurveyQuestionHeaders(selectedSheet.headers).length;
    dimensions = [
      ...rawSurveyDimensions(selectedSheet.headers),
      ...Object.values(codebook)
        .filter((entry) => rawSurveyDimensions([entry.title]).length)
        .map((entry) => entry.title),
    ].filter((value, index, values) => values.indexOf(value) === index);
  } else if (dataSheets.length) {
    format = IMPORT_FORMATS.RAW_SURVEY;
    selectedSheet = dataSheets.sort((left, right) => right.row_count - left.row_count)[0];
    questionCount = rawSurveyQuestionHeaders(selectedSheet.headers).length;
    dimensions = rawSurveyDimensions(selectedSheet.headers);
  }

  sheets.forEach((sheet) => {
    let role = "other";
    if (sheet === selectedSheet) role = "primary_data";
    else if (sheet.flags.is_code) role = "codebook";
    else if (sheet.flags.is_instruction) role = "instructions";
    else if (sheet.flags.has_caption) role = "crosstab";
    sheet.role = role;
  });

  if (format === IMPORT_FORMATS.UNKNOWN && !diagnostics.length) {
    diagnostics.push(diagnostic(
      "error",
      "UNRECOGNIZED_WORKBOOK",
      "未找到可识别的交叉表、原始问卷、KANO 或 data + code 结构。",
      "请确认首行是字段名；交叉表应包含 CAPTION 或“题目/选项 + 总体”表头；原始数据应至少包含两列和一行样本。"
    ));
  }
  if (format !== IMPORT_FORMATS.UNKNOWN && questionCount === 0) {
    diagnostics.push(diagnostic(
      "error",
      "NO_QUESTIONS_DETECTED",
      `已识别为${IMPORT_FORMAT_LABELS[format]}，但没有定位到题目或字段。`,
      "请检查题号/字段名是否位于同一表头行，且题目编码未被合并单元格或空白列隔开。",
      selectedSheet?.name || ""
    ));
  }
  if (!dimensions.length && [IMPORT_FORMATS.STANDARD_CROSSTAB, IMPORT_FORMATS.FLAT_CROSSTAB].includes(format)) {
    diagnostics.push(diagnostic(
      "warning",
      "NO_GROUP_DIMENSIONS",
      "已识别题目，但没有识别到可对比的人群分组。",
      "请保留 Total/总体列，并在其右侧放置至少一个分组列；多级表头请勿删除维度名称。",
      selectedSheet?.name || ""
    ));
  }
  if (options.target === "pptx_crosstab" && ![
    IMPORT_FORMATS.STANDARD_CROSSTAB,
    IMPORT_FORMATS.FLAT_CROSSTAB,
  ].includes(format)) {
    diagnostics.push(diagnostic(
      "error",
      "PPTX_REQUIRES_CROSSTAB",
      `当前页面需要交叉表，但文件结构是${IMPORT_FORMAT_LABELS[format] || "未知格式"}。`,
      "请先在“交叉表分析”中把原始数据生成标准交叉表，再回到此页面上传导出的交叉表。",
      selectedSheet?.name || ""
    ));
  }

  const hasError = diagnostics.some((item) => item.severity === "error");
  const hasWarning = diagnostics.some((item) => item.severity === "warning");
  return {
    version: "surveykit_import_inspection_v1",
    status: hasError ? "error" : hasWarning ? "warning" : "ready",
    format,
    format_label: IMPORT_FORMAT_LABELS[format],
    selected_sheet: selectedSheet?.name || "",
    sheets: sheets.map((sheet) => ({
      index: sheet.index,
      name: sheet.name,
      role: sheet.role,
      row_count: sheet.row_count,
      column_count: sheet.column_count,
      header_row_index: sheet.header_row_index,
      headers: sheet.headers.slice(0, 20),
      preview: sheet.preview,
    })),
    metrics: {
      sheet_count: sheets.length,
      question_count: questionCount,
      dimension_count: dimensions.length,
      dimensions,
      row_count: selectedSheet?.row_count || 0,
      column_count: selectedSheet?.column_count || 0,
    },
    diagnostics,
  };
}

// ─── SAV 解析 ───────────────────────────────────────────────

export function decodeSavText(bytes, encoding = "") {
  const cleaned = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = cleaned.findIndex(byte => byte === 0);
  const slice = cleaned.slice(0, end >= 0 ? end : cleaned.length);
  if (encoding) return new TextDecoder(encoding).decode(slice).trim().replace(/\uFFFD+$/, "…");
  try {
    // Streaming decode tolerates an incomplete final character, but still
    // rejects invalid bytes inside the text. Never turn one cut character into GBK.
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(slice, { stream: true });
    try { return (text + decoder.decode()).trim(); } catch { return text.trimEnd() + "…"; }
  } catch { return new TextDecoder("gb18030").decode(slice).trim(); }
}

function savPad(length, unit = 4) {
  return (unit - (length % unit)) % unit;
}

function savNumberText(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e100) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

function savLabelKey(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(10)));
  return String(value || "").trim();
}

function savValueFromBytes(bytes, variable) {
  if (variable.type === 0) {
    const number = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    return savNumberText(number);
  }
  return decodeSavText(bytes).slice(0, Math.max(0, variable.type)).trim();
}

function savFormatDisplayValue(variable, rawValue) {
  if (!rawValue) return "";
  return variable.valueLabels?.get(savLabelKey(rawValue)) || rawValue;
}

function savUniqueHeader(headers, title) {
  const base = title || `字段${headers.length + 1}`;
  let candidate = base;
  let index = 2;
  while (headers.includes(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

/**
 * 解析 SAV 文件为结构化数据
 * @returns {{ displayHeaders: string[], headerInfos: object[], rawRows: object[], displayRows: object[] }}
 */
export function parseSavFile(arrayBuffer, resolveQuestionTitle) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const magic = decodeSavText(bytes.slice(0, 4));
  if (magic !== "$FL2" && magic !== "$FL3") throw new Error("当前文件不是标准 SAV 文件。");

  const littleEndian = view.getInt32(64, true) === 2 || view.getInt32(64, true) === 3;
  const compression = view.getInt32(72, littleEndian);
  const caseCount = view.getInt32(80, littleEndian);
  const bias = view.getFloat64(84, littleEndian) || 100;
  let offset = 176;
  const records = [];
  let textEncoding = "";
  const encodedText = [];
  let pendingLabels = null;

  const readInt = () => {
    const value = view.getInt32(offset, littleEndian);
    offset += 4;
    return value;
  };

  while (offset + 4 <= bytes.length) {
    const recordType = readInt();
    if (recordType === 2) {
      const variableType = readInt();
      const hasLabel = readInt();
      const missingCount = readInt();
      readInt(); readInt();
      const name = decodeSavText(bytes.slice(offset, offset + 8)).replace(/\s+/g, "");
      offset += 8;
      let label = "";
      if (hasLabel) {
        const labelLength = readInt();
        label = decodeSavText(bytes.slice(offset, offset + labelLength));
        encodedText.push({ bytes: bytes.slice(offset, offset + labelLength), recordIndex: records.length });
        offset += labelLength + savPad(labelLength, 4);
      }
      offset += Math.abs(missingCount) * 8;
      records.push({ type: variableType, name, label, valueLabels: new Map() });
    } else if (recordType === 3) {
      const labelCount = readInt();
      pendingLabels = [];
      for (let index = 0; index < labelCount; index += 1) {
        const valueBytes = bytes.slice(offset, offset + 8);
        offset += 8;
        const labelLength = bytes[offset] || 0;
        offset += 1;
        const label = decodeSavText(bytes.slice(offset, offset + labelLength));
        offset += labelLength + savPad(labelLength + 1, 8);
        pendingLabels.push({ valueBytes, label, labelBytes: bytes.slice(offset - labelLength - savPad(labelLength + 1, 8), offset - savPad(labelLength + 1, 8)) });
      }
    } else if (recordType === 4) {
      const variableCount = readInt();
      const indexes = Array.from({ length: variableCount }, () => readInt() - 1);
      indexes.forEach((recordIndex) => {
        const variable = records[recordIndex];
        if (!variable || !pendingLabels) return;
        pendingLabels.forEach((item) => {
          const key = variable.type === 0
            ? savLabelKey(new DataView(item.valueBytes.buffer, item.valueBytes.byteOffset, item.valueBytes.byteLength).getFloat64(0, littleEndian))
            : savLabelKey(decodeSavText(item.valueBytes).trim());
          variable.valueLabels.set(key, item.label);
          if (item.labelBytes) encodedText.push({ bytes: item.labelBytes, recordIndex, key });
        });
      });
      pendingLabels = null;
    } else if (recordType === 6) {
      const lineCount = readInt();
      offset += lineCount * 80;
    } else if (recordType === 7) {
      const subtype = readInt();
      const size = readInt();
      const count = readInt();
      if (subtype === 20 && size === 1) textEncoding = decodeSavText(bytes.slice(offset, offset + count));
      offset += size * count;
    } else if (recordType === 999) {
      offset += 4;
      break;
    } else {
      throw new Error(`暂不支持的 SAV 字典记录类型：${recordType}`);
    }
  }

  if (textEncoding) {
    try { new TextDecoder(textEncoding); } catch { textEncoding = ""; }
    for (const item of encodedText) {
      const decoded = decodeSavText(item.bytes, textEncoding);
      if (item.key === undefined) records[item.recordIndex].label = decoded;
      else records[item.recordIndex].valueLabels.set(item.key, decoded);
    }
  }

  const activeVariables = records.filter((record) => record.type !== -1);
  if (!activeVariables.length || caseCount <= 0) throw new Error("SAV 文件中未识别到有效变量或样本。");

  let savInstructionQueue = [];
  const nextUnit = () => {
    if (compression === 0) {
      const unit = bytes.slice(offset, offset + 8);
      offset += 8;
      return { bytes: unit };
    }
    while (savInstructionQueue.length || offset < bytes.length) {
      if (!savInstructionQueue.length) {
        savInstructionQueue = Array.from(bytes.slice(offset, offset + 8));
        offset += 8;
      }
      const code = savInstructionQueue.shift();
      if (code === 0) continue;
      if (code === 252) return { eof: true };
      if (code === 253) {
        const unit = bytes.slice(offset, offset + 8);
        offset += 8;
        return { bytes: unit };
      }
      if (code === 254) return { bytes: new Uint8Array(8).fill(32) };
      if (code === 255) return { missing: true, bytes: new Uint8Array(8) };
      return { number: code - bias };
    }
    return { eof: true };
  };

  const displayHeaders = [];
  const headerInfos = [];
  activeVariables.forEach((variable) => {
    let resolvedLabel = variable.label || "";
    if (!resolvedLabel && resolveQuestionTitle) {
      const mapped = resolveQuestionTitle(variable.name);
      if (mapped) resolvedLabel = mapped;
    }
    const title = savUniqueHeader(displayHeaders, resolvedLabel ? `${variable.name} ${resolvedLabel}` : variable.name);
    displayHeaders.push(title);
    const fullLabel = resolvedLabel || "";
    const optionMatch = fullLabel.match(/[:：]([^:：]+)$/);
    const parentTitle = optionMatch ? fullLabel.replace(/[:：][^:：]+$/, "").trim() : fullLabel;
    const optionLabel = optionMatch ? optionMatch[1].trim() : null;
    headerInfos.push({
      sourceHeader: variable.name,
      source: variable.name,
      title,
      parentTitle,
      optionLabel,
      options: Object.fromEntries(variable.valueLabels.entries()),
      binary: false
    });
  });

  const rawRows = [];
  const displayRows = [];
  for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
    const rawRow = {};
    const displayRow = {};
    let activeIndex = 0;
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const record = records[recordIndex];
      if (record.type === 0) {
        const unit = nextUnit();
        const rawValue = unit.missing || unit.eof
          ? ""
          : unit.number !== undefined
            ? savNumberText(unit.number)
            : savValueFromBytes(unit.bytes, record);
        if (record.name) {
          const displayHeader = displayHeaders[activeIndex];
          rawRow[record.name] = rawValue;
          displayRow[displayHeader] = savFormatDisplayValue(record, rawValue);
          activeIndex += 1;
        }
      } else if (record.type > 0) {
        const slotCount = Math.ceil(record.type / 8);
        const chunks = [];
        for (let slot = 0; slot < slotCount; slot += 1) {
          const unit = nextUnit();
          chunks.push(unit.bytes || new Uint8Array(8));
        }
        const rawValue = decodeSavText(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))).slice(0, record.type).trim();
        const displayHeader = displayHeaders[activeIndex];
        rawRow[record.name] = rawValue;
        displayRow[displayHeader] = savFormatDisplayValue(record, rawValue);
        activeIndex += 1;
        recordIndex += slotCount - 1;
      } else {
        nextUnit();
      }
    }
    rawRows.push(rawRow);
    displayRows.push(displayRow);
  }

  return { displayHeaders, headerInfos, rawRows, displayRows };
}

// ─── Codebook 解析 ──────────────────────────────────────────

export function normalizeCodebookTitle(variable, text) {
  return String(text || "")
    .replace(new RegExp(`^${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.．]?\\s*`, "i"), "")
    .replace(/【[^】]*】/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCodebookRows(rows) {
  const codebook = {};
  let current = null;
  rows.forEach((row) => {
    const line = row.map((cell) => String(cell || "").trim()).filter(Boolean).join(" ").trim();
    if (!line || /^本题选项/.test(line)) return;
    const questionMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*?)\s*[.．]\s*(.+)$/);
    if (questionMatch) {
      const variable = questionMatch[1].trim();
      const title = normalizeCodebookTitle(variable, questionMatch[2]);
      current = { variable, title: title || variable, options: {} };
      codebook[variable] = current;
      return;
    }
    const optionMatch = line.match(/^([0-9]+)\s*[.．、]\s*(.+)$/);
    if (optionMatch && current) {
      current.options[optionMatch[1]] = optionMatch[2].trim();
    }
  });
  return codebook;
}

export function getMappedVariableInfo(variable, codebook) {
  if (codebook[variable]) {
    return { source: variable, title: `${variable} ${codebook[variable].title}`, options: codebook[variable].options, binary: false };
  }
  const multiMatch = String(variable).match(/^(.+)__([0-9]+)$/);
  if (multiMatch && codebook[multiMatch[1]]) {
    const parent = codebook[multiMatch[1]];
    const optionLabel = parent.options[multiMatch[2]] || `选项${multiMatch[2]}`;
    return {
      source: multiMatch[1],
      title: `${multiMatch[1]}__${multiMatch[2]} ${optionLabel}`,
      parentTitle: `${multiMatch[1]} ${parent.title}`,
      optionLabel,
      optionCode: multiMatch[2],
      options: { "0": "未选", "1": "选中" },
      binary: true
    };
  }
  return { source: variable, title: variable, options: {}, binary: false };
}
