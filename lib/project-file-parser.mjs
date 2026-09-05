import { applyUserMissing, readSav, SavError } from "datareader-spss";

const SUPPORTED_EXTENSIONS = new Set(["docx", "pdf", "txt", "md", "csv", "xlsx", "sav", "pptx"]);
const MIME_BY_EXTENSION = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sav: "application/x-spss-sav",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});
const GENERIC_MIMES = new Set(["", "application/octet-stream", "application/zip", "application/x-zip-compressed"]);
const MAX_DECOMPRESSED_ENTRY_BYTES = 32 * 1024 * 1024;
const qualitativeExcelModule = import("./qualitative-excel.mjs");

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

export function safeFileName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/\0-\x1f\x7f]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

export function extensionOf(fileName) {
  return safeFileName(fileName).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
}

export function validateProjectFile({ fileName, mimeType, size, maxBytes = 10 * 1024 * 1024 }) {
  const name = safeFileName(fileName);
  const extension = extensionOf(name);
  const normalizedMime = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  const boundedMax = clampInteger(maxBytes, 10 * 1024 * 1024, 1024, 25 * 1024 * 1024);
  if (!name || !extension) return { ok: false, code: "FILE_NAME_INVALID", message: "文件名或扩展名无效。" };
  if (!SUPPORTED_EXTENSIONS.has(extension)) return { ok: false, code: "FILE_TYPE_UNSUPPORTED", message: "仅支持 DOCX、PDF、TXT、MD、CSV、XLSX、SAV 和 PPTX。" };
  if (!Number.isFinite(Number(size)) || Number(size) <= 0) return { ok: false, code: "FILE_EMPTY", message: "文件内容为空。" };
  if (Number(size) > boundedMax) return { ok: false, code: "FILE_TOO_LARGE", message: `文件不能超过 ${Math.ceil(boundedMax / 1024 / 1024)}MB。` };
  const expected = MIME_BY_EXTENSION[extension];
  const allowedTextAlias = ["md", "csv"].includes(extension) && ["text/plain", "application/vnd.ms-excel"].includes(normalizedMime);
  const allowedSavAlias = extension === "sav" && ["application/x-spss", "application/vnd.spss.sav"].includes(normalizedMime);
  if (!GENERIC_MIMES.has(normalizedMime) && normalizedMime !== expected && !allowedTextAlias && !allowedSavAlias) {
    return { ok: false, code: "FILE_MIME_MISMATCH", message: "文件扩展名与内容类型不匹配。" };
  }
  return { ok: true, fileName: name, extension, mimeType: expected, maxBytes: boundedMax };
}

function uint16(bytes, index) { return bytes[index] | (bytes[index + 1] << 8); }
function uint32(bytes, index) { return (bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24)) >>> 0; }

function zipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map();
  for (let index = 0; index <= bytes.length - 46; index += 1) {
    if (uint32(bytes, index) !== 0x02014b50) continue;
    const compression = uint16(bytes, index + 10);
    const compressedSize = uint32(bytes, index + 20);
    const uncompressedSize = uint32(bytes, index + 24);
    const fileNameLength = uint16(bytes, index + 28);
    const extraLength = uint16(bytes, index + 30);
    const commentLength = uint16(bytes, index + 32);
    const localOffset = uint32(bytes, index + 42);
    const nameStart = index + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));
    if (localOffset + 30 <= bytes.length && uint32(bytes, localOffset) === 0x04034b50) {
      const localNameLength = uint16(bytes, localOffset + 26);
      const localExtraLength = uint16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      entries.set(name, { compression, uncompressedSize, data: bytes.subarray(dataStart, dataStart + compressedSize) });
    }
    index = nameStart + fileNameLength + extraLength + commentLength - 1;
  }
  if (!entries.size) throw new Error("ZIP_DIRECTORY_MISSING");
  return entries;
}

async function decompress(data, format, maximum = MAX_DECOMPRESSED_ENTRY_BYTES) {
  if (!("DecompressionStream" in globalThis)) throw new Error("DECOMPRESSION_UNAVAILABLE");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new Error("DECOMPRESSED_CONTENT_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function zipText(entries, name) {
  const entry = entries.get(name);
  if (!entry) return "";
  if (entry.uncompressedSize > MAX_DECOMPRESSED_ENTRY_BYTES) throw new Error("ZIP_ENTRY_TOO_LARGE");
  if (entry.compression === 0) return new TextDecoder("utf-8").decode(entry.data);
  if (entry.compression === 8) return new TextDecoder("utf-8").decode(await decompress(entry.data, "deflate-raw", Math.min(MAX_DECOMPRESSED_ENTRY_BYTES, Math.max(entry.uncompressedSize || 0, 1_024))));
  throw new Error("ZIP_COMPRESSION_UNSUPPORTED");
}

async function zipTextWithLimit(entries, name, maximum) {
  const entry = entries.get(name);
  if (!entry) return "";
  if (entry.uncompressedSize > maximum) throw new Error("ZIP_ENTRY_TOO_LARGE");
  if (entry.compression === 0) return new TextDecoder("utf-8").decode(entry.data);
  if (entry.compression === 8) return new TextDecoder("utf-8").decode(await decompress(entry.data, "deflate-raw", Math.min(maximum, Math.max(entry.uncompressedSize || 0, 1_024))));
  throw new Error("ZIP_COMPRESSION_UNSUPPORTED");
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"").replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value) {
  return String(value || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function xmlRuns(xml, tag = "(?:w|a):t") {
  return [...String(xml || "").matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g"))]
    .map((match) => decodeXml(match[1])).filter(Boolean);
}

function docxText(xml) {
  const body = String(xml || "").match(/<w:body\b[\s\S]*?<\/w:body>/)?.[0] || String(xml || "");
  const blocks = [];
  for (const match of body.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)) {
    if (match[1] === "p") {
      const text = xmlRuns(match[0], "w:t").join("").trim();
      if (text) blocks.push(text);
      continue;
    }
    const rows = [...match[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((row) =>
      [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) => xmlRuns(cell[0], "w:t").join("").trim())
    ).filter((row) => row.some(Boolean));
    if (rows.length) blocks.push(rows.map((row) => row.join(" | ")).join("\n"));
  }
  return normalizeText(blocks.join("\n\n"));
}

function workbookSheetMap(workbookXml, relsXml) {
  const rels = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((match) => [match[1], match[2].startsWith("/") ? match[2].slice(1) : `xl/${match[2].replace(/^\.\//, "")}`]));
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map((match, index) => {
    const attrs = match[1] || "";
    const id = attrs.match(/r:id="([^"]+)"/)?.[1] || "";
    return { name: decodeXml(attrs.match(/name="([^"]+)"/)?.[1] || `Sheet${index + 1}`), path: rels.get(id) || `xl/worksheets/sheet${index + 1}.xml` };
  });
  return sheets.length ? sheets : [{ name: "Sheet1", path: "xl/worksheets/sheet1.xml" }];
}

function sharedStrings(xml) {
  return [...xml.matchAll(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g)].map((match) => xmlRuns(match[0], "(?:\\w+:)?t").join(""));
}

function columnIndex(ref) {
  return (String(ref || "").match(/[A-Z]+/i)?.[0] || "").toUpperCase().split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function sheetRows(xml, strings, maxRows = 12, maxColumns = 30) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cell[1] || ""; const body = cell[2] || "";
      const index = Math.max(0, columnIndex(attrs.match(/r="([^"]+)"/)?.[1] || ""));
      if (index >= maxColumns) continue;
      const raw = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] || "";
      const inline = xmlRuns(body, "(?:\\w+:)?t").join("");
      row[index] = /t="s"/.test(attrs) ? strings[Number(raw)] || "" : decodeXml(inline || raw);
    }
    if (row.some(Boolean)) rows.push(Array.from({ length: Math.min(maxColumns, row.length) }, (_, index) => row[index] ?? ""));
    if (rows.length >= maxRows) break;
  }
  return rows;
}

function delimitedRows(text) {
  const lines = String(text || "").replace(/^\ufeff/, "").split(/\r?\n/).filter((line) => line.trim());
  const delimiter = (lines[0] || "").includes("\t") ? "\t" : ",";
  return lines.map((line) => {
    const cells = []; let cell = ""; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]; const next = line[index + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += char;
    }
    cells.push(cell.trim()); return cells;
  });
}

function tableFromRows(name, rows) {
  if (rows.length < 2) throw Object.assign(new Error("数据表至少需要表头和一行数据。"), { code: "DATASET_EMPTY" });
  const headers = rows[0].map((value) => String(value || "").trim());
  if (headers.some((header) => !header)) throw Object.assign(new Error("无法识别有效数据表，请确认首行为变量名且不存在空字段。"), { code: "DATASET_HEADERS_INVALID" });
  if (new Set(headers).size !== headers.length) throw Object.assign(new Error("变量名存在重复，请先在原文件中设置唯一字段名。"), { code: "DATASET_HEADERS_DUPLICATE" });
  return {
    name,
    headers,
    rows: rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? "").trim()]))),
  };
}

function datasetCellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  }
  return String(value).trim();
}

function savValueKey(value) {
  return value instanceof Date ? value.toISOString() : datasetCellText(value);
}

function savVariableMetadata(variable, header) {
  return {
    name: header,
    source_name: String(variable?.name || header),
    label: String(variable?.label || "").trim(),
    type: variable?.type || "unknown",
    measure: variable?.measure || "unknown",
    width: Number(variable?.width || 0) || undefined,
    format: variable?.format || null,
    missing: variable?.missing || { kind: "none" },
    value_labels: (variable?.valueLabels || []).map((item) => ({ value: datasetCellText(item.value), label: String(item.label || "") })),
  };
}

function uniqueSavHeaders(variables) {
  const used = new Set();
  return variables.map((variable, index) => {
    const base = String(variable?.name || `VAR${index + 1}`).trim() || `VAR${index + 1}`;
    let candidate = base; let suffix = 2;
    while (used.has(candidate)) { candidate = `${base}_${suffix}`; suffix += 1; }
    used.add(candidate); return candidate;
  });
}

async function savTable(arrayBuffer, options, maxRows, maxColumns) {
  const defaultCells = Math.min(5_000_000, maxRows * maxColumns);
  const maxCells = clampInteger(options.maxCells, defaultCells, 100, 10_000_000);
  const maxInflatedBytes = clampInteger(options.maxInflatedBytes, 64 * 1024 * 1024, 1024, 96 * 1024 * 1024);
  try {
    const parsed = await readSav(arrayBuffer, { maxCells, maxInflatedBytes });
    const sourceSheet = parsed.sheets?.[0];
    if (!sourceSheet?.variables?.length) throw Object.assign(new Error("SAV 文件中没有可读取的变量。"), { code: "DATASET_EMPTY" });
    const sheet = applyUserMissing(sourceSheet);
    const variables = sheet.variables.slice(0, maxColumns);
    const headers = uniqueSavHeaders(variables);
    const labelMaps = variables.map((variable) => new Map((variable.valueLabels || []).map((item) => [savValueKey(item.value), String(item.label || "").trim()])));
    const rows = sheet.rows.slice(0, maxRows).map((cells) => Object.fromEntries(headers.map((header, index) => {
      const raw = cells[index]; const label = labelMaps[index].get(savValueKey(raw));
      return [header, label || datasetCellText(raw)];
    })));
    const variableMetadata = variables.map((variable, index) => savVariableMetadata(variable, headers[index]));
    return {
      name: options.sheetName || sourceSheet.name || "Data",
      headers,
      rows,
      variables: variableMetadata,
      encoding: parsed.encoding || "",
      source_format: "sav",
    };
  } catch (error) {
    if (error?.code === "DATASET_EMPTY") throw error;
    const code = error instanceof SavError ? "DATASET_SAV_INVALID" : "DATASET_SAV_UNSUPPORTED";
    throw Object.assign(new Error(`SAV 解析失败：${String(error?.message || "文件结构不受支持")}`), { code });
  }
}

export async function parseDatasetFile(arrayBuffer, options = {}) {
  const extension = String(options.extension || "xlsx").toLowerCase();
  const maxRows = clampInteger(options.maxRows, 100_000, 1, 250_000);
  const maxColumns = clampInteger(options.maxColumns, 2_048, 1, 4_096);
  if (extension === "csv") {
    const decoded = new TextDecoder("utf-8").decode(arrayBuffer);
    const table = tableFromRows(options.sheetName || "CSV", delimitedRows(decoded).slice(0, maxRows + 1));
    return { sheets: [table], selected: table };
  }
  if (extension === "sav") {
    const table = await savTable(arrayBuffer, options, maxRows, maxColumns);
    return { sheets: [table], selected: table, encoding: table.encoding, source_format: "sav" };
  }
  if (extension !== "xlsx") throw Object.assign(new Error("数据集仅支持 XLSX、CSV 或 SAV。"), { code: "DATASET_FILE_UNSUPPORTED" });
  const entries = zipEntries(arrayBuffer);
  const maximum = 96 * 1024 * 1024;
  const workbook = await zipTextWithLimit(entries, "xl/workbook.xml", maximum);
  const rels = await zipTextWithLimit(entries, "xl/_rels/workbook.xml.rels", maximum);
  const strings = sharedStrings(await zipTextWithLimit(entries, "xl/sharedStrings.xml", maximum));
  const sheets = [];
  for (const sheet of workbookSheetMap(workbook, rels).slice(0, 20)) {
    const xml = await zipTextWithLimit(entries, sheet.path, maximum);
    if (!xml) continue;
    const rows = sheetRows(xml, strings, maxRows + 1, maxColumns);
    if (rows.length >= 2) sheets.push(tableFromRows(sheet.name, rows));
  }
  if (!sheets.length) throw Object.assign(new Error("无法识别有效数据表，请确认首行为变量名。"), { code: "DATASET_EMPTY" });
  const selected = options.sheetName ? sheets.find((sheet) => sheet.name === options.sheetName) : sheets[0];
  if (!selected) throw Object.assign(new Error(`工作表 ${options.sheetName} 不存在。`), { code: "DATASET_SHEET_NOT_FOUND" });
  return { sheets, selected };
}

function decodePdfLiteral(value) {
  return String(value || "").replace(/\\([nrtbf()\\])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[char] || char))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function decodePdfHex(value) {
  const hex = String(value || "").replace(/\s+/g, "");
  if (!hex || /[^0-9a-f]/i.test(hex)) return "";
  const padded = hex.length % 2 ? `${hex}0` : hex;
  const bytes = Uint8Array.from(padded.match(/../g) || [], (pair) => Number.parseInt(pair, 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = ""; for (let index = 2; index + 1 < bytes.length; index += 2) output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]); return output;
  }
  return new TextDecoder("latin1").decode(bytes);
}

function latin1Bytes(value) {
  const bytes = new Uint8Array(String(value || "").length);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function pdfTextOperators(content) {
  if (!/\bBT\b[\s\S]*?\bET\b/.test(content)) return [];
  const lines = [];
  for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const text = block[1];
    for (const match of text.matchAll(/\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|<([0-9a-f\s]+)>\s*Tj|\[([\s\S]*?)\]\s*TJ/gi)) {
      if (match[0].startsWith("(")) lines.push(decodePdfLiteral(match[0].replace(/^\(|\)\s*(?:Tj|'|")$/g, "")));
      else if (match[1]) lines.push(decodePdfHex(match[1]));
      else if (match[2]) {
        const pieces = [...match[2].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9a-f\s]+)>/gi)].map((piece) => piece[0].startsWith("(") ? decodePdfLiteral(piece[0].slice(1, -1)) : decodePdfHex(piece[1]));
        lines.push(pieces.join(""));
      }
    }
  }
  return lines.map((line) => line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim()).filter((line) => /[\p{L}\p{N}]/u.test(line));
}

async function parsePdf(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("PDF_SIGNATURE_INVALID");
  const source = new TextDecoder("latin1").decode(bytes);
  const lines = [...pdfTextOperators(source)];
  for (const match of source.matchAll(/([\s\S]{0,300})stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const header = match[1] || "";
    let streamBytes = latin1Bytes(match[2]);
    try {
      if (/\/FlateDecode/.test(header)) streamBytes = await decompress(streamBytes, "deflate");
      lines.push(...pdfTextOperators(new TextDecoder("latin1").decode(streamBytes)));
    } catch { /* continue with other streams */ }
  }
  return normalizeText([...new Set(lines)].join("\n"));
}

function buildSummary(parsedText, metadata, maxChars) {
  const prefix = metadata ? `${metadata}\n\n` : "";
  const text = normalizeText(parsedText);
  const remaining = Math.max(0, maxChars - prefix.length);
  if (text.length <= remaining) return normalizeText(prefix + text);
  const headings = text.split("\n").filter((line) => /^(?:#{1,4}\s+|第.{1,12}[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+)*[、.．\s])/.test(line)).slice(0, 12).join("\n");
  const excerpt = text.slice(0, Math.max(0, remaining - headings.length - 24));
  return normalizeText(`${prefix}${headings ? `关键结构：\n${headings}\n\n` : ""}${excerpt}\n…`);
}

export async function parseProjectFile(arrayBuffer, options = {}) {
  const extension = String(options.extension || extensionOf(options.fileName)).toLowerCase();
  const maxParsedChars = clampInteger(options.maxParsedChars, 250_000, 2_000, 750_000);
  const summaryChars = clampInteger(options.summaryChars, 2_000, 300, 8_000);
  let parsedText = ""; let metadata = ""; let structuredData = {};
  if (["txt", "md", "csv"].includes(extension)) {
    parsedText = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
  } else if (extension === "docx") {
    const entries = zipEntries(arrayBuffer);
    parsedText = docxText(await zipText(entries, "word/document.xml"));
  } else if (extension === "xlsx") {
    const entries = zipEntries(arrayBuffer);
    const workbook = await zipText(entries, "xl/workbook.xml");
    const rels = await zipText(entries, "xl/_rels/workbook.xml.rels");
    const strings = sharedStrings(await zipText(entries, "xl/sharedStrings.xml"));
    const sections = []; const sheets = [];
    for (const sheet of workbookSheetMap(workbook, rels).slice(0, 20)) {
      const xml = await zipText(entries, sheet.path);
      if (!xml) continue;
      const rows = sheetRows(xml, strings);
      const dimension = xml.match(/<dimension[^>]*ref="[A-Z]+\d+:([A-Z]+)(\d+)"/) || [];
      const rowCount = Number(dimension[2] || rows.length);
      const columnCount = dimension[1] ? columnIndex(dimension[1]) + 1 : Math.max(0, ...rows.map((row) => row.length));
      const headers = rows[0] || [];
      sheets.push({
        name: sheet.name,
        row_count: rowCount,
        column_count: columnCount,
        fields: headers.filter(Boolean).slice(0, 30),
        preview_rows: rows.slice(1, 7).map((row) => row.slice(0, 30)),
      });
      sections.push(`Sheet: ${sheet.name}\nRows: ${rowCount}\nColumns: ${columnCount}\nFields: ${headers.filter(Boolean).join(", ") || "未识别"}\nPreview:\n${rows.slice(1, 7).map((row) => row.join(" | ")).join("\n") || "无数据预览"}`);
    }
    metadata = `工作簿共 ${sections.length} 个可读取 Sheet`;
    const { inspectQualitativeSummaryTemplate } = await qualitativeExcelModule;
    const qualitativeTemplate = await inspectQualitativeSummaryTemplate(arrayBuffer).catch(() => null);
    structuredData = qualitativeTemplate
      ? { ...qualitativeTemplate, workbook: { kind: "xlsx_workbook", sheet_count: sheets.length, sheets } }
      : { kind: "xlsx_workbook", sheet_count: sheets.length, sheets };
    parsedText = sections.join("\n\n");
  } else if (extension === "sav") {
    const workbook = await parseDatasetFile(arrayBuffer, { extension: "sav" });
    const sheets = workbook.sheets.map((sheet) => ({
      name: sheet.name,
      row_count: sheet.rows.length,
      column_count: sheet.headers.length,
      fields: sheet.headers.slice(0, 80),
      variables: (sheet.variables || []).slice(0, 80).map((variable) => ({ ...variable, value_labels: (variable.value_labels || []).slice(0, 30) })),
      field_count: sheet.headers.length,
      fields_truncated: sheet.headers.length > 80,
      variable_count: (sheet.variables || []).length,
      variables_truncated: (sheet.variables || []).length > 80,
    }));
    structuredData = { kind: "sav_dataset", encoding: workbook.encoding || "", sheet_count: sheets.length, sheets };
    metadata = `SPSS SAV 数据集共 ${sheets[0]?.row_count || 0} 条样本、${sheets[0]?.column_count || 0} 个变量`;
    parsedText = sheets.map((sheet) => `Dataset: ${sheet.name}\nRows: ${sheet.row_count}\nColumns: ${sheet.column_count}\nFields: ${sheet.fields.join(", ") || "未识别"}`).join("\n\n");
  } else if (extension === "pptx") {
    const entries = zipEntries(arrayBuffer);
    const slides = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    const sections = [];
    for (const [index, slide] of slides.entries()) {
      const text = xmlRuns(await zipText(entries, slide), "a:t").map((item) => item.trim()).filter(Boolean);
      const notes = await zipText(entries, `ppt/notesSlides/notesSlide${index + 1}.xml`);
      const noteText = xmlRuns(notes, "a:t").map((item) => item.trim()).filter(Boolean);
      sections.push(`第 ${index + 1} 页${text[0] ? `：${text[0]}` : ""}\n${text.slice(1).join("\n")}${noteText.length ? `\n备注：${noteText.join(" ")}` : ""}`.trim());
    }
    metadata = `演示文稿共 ${slides.length} 页`;
    parsedText = sections.join("\n\n");
  } else if (extension === "pdf") {
    parsedText = await parsePdf(arrayBuffer);
    if (!parsedText) return { status: "unsupported", parsedText: "", summary: "", structuredData: {}, parseNote: "未检测到可用文本层，需要 OCR。" };
  } else {
    return { status: "unsupported", parsedText: "", summary: "", structuredData: {}, parseNote: "暂不支持该文件格式。" };
  }
  parsedText = normalizeText(parsedText).slice(0, maxParsedChars);
  if (!parsedText) return { status: "failed", parsedText: "", summary: "", structuredData, parseNote: "文件中未提取到可用文本。" };
  return { status: "completed", parsedText, summary: buildSummary(parsedText, metadata, summaryChars), structuredData, parseNote: parsedText.length >= maxParsedChars ? "解析文本已按项目上限截断。" : "" };
}

export const projectFileTypes = { supportedExtensions: [...SUPPORTED_EXTENSIONS], mimeByExtension: MIME_BY_EXTENSION };
