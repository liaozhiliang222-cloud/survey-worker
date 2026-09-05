const MAX_ZIP_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_CELL_CHARS = 4_000;

function uint16(bytes, index) { return bytes[index] | (bytes[index + 1] << 8); }
function uint32(bytes, index) { return (bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24)) >>> 0; }

async function inflate(data, size) {
  if (!("DecompressionStream" in globalThis)) throw new Error("DECOMPRESSION_UNAVAILABLE");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > Math.min(MAX_ZIP_ENTRY_BYTES, Math.max(size || 0, 1_024))) throw new Error("ZIP_ENTRY_TOO_LARGE");
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

async function readZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder("utf-8");
  const files = new Map();
  let total = 0;
  for (let index = 0; index <= bytes.length - 46; index += 1) {
    if (uint32(bytes, index) !== 0x02014b50) continue;
    const compression = uint16(bytes, index + 10);
    const compressedSize = uint32(bytes, index + 20);
    const uncompressedSize = uint32(bytes, index + 24);
    const nameLength = uint16(bytes, index + 28);
    const extraLength = uint16(bytes, index + 30);
    const commentLength = uint16(bytes, index + 32);
    const localOffset = uint32(bytes, index + 42);
    const nameStart = index + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES || total + uncompressedSize > MAX_ZIP_TOTAL_BYTES) throw new Error("ZIP_CONTENT_TOO_LARGE");
    if (localOffset + 30 > bytes.length || uint32(bytes, localOffset) !== 0x04034b50) throw new Error("ZIP_LOCAL_HEADER_INVALID");
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (compression === 0) content = new Uint8Array(compressed);
    else if (compression === 8) content = await inflate(compressed, uncompressedSize);
    else throw new Error("ZIP_COMPRESSION_UNSUPPORTED");
    files.set(name, content);
    total += content.byteLength;
    index = nameStart + nameLength + extraLength + commentLength - 1;
  }
  if (!files.size) throw new Error("ZIP_DIRECTORY_MISSING");
  return files;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function push16(target, value) { target.push(value & 0xff, (value >>> 8) & 0xff); }
function push32(target, value) { target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function concat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function writeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [entryName, raw] of files) {
    const name = encoder.encode(entryName);
    const data = raw instanceof Uint8Array ? raw : encoder.encode(String(raw ?? ""));
    const checksum = crc32(data);
    const local = [];
    push32(local, 0x04034b50); push16(local, 20); push16(local, 0x0800); push16(local, 0);
    push16(local, 0); push16(local, 0); push32(local, checksum); push32(local, data.length); push32(local, data.length);
    push16(local, name.length); push16(local, 0);
    localParts.push(new Uint8Array(local), name, data);
    const central = [];
    push32(central, 0x02014b50); push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
    push16(central, 0); push16(central, 0); push32(central, checksum); push32(central, data.length); push32(central, data.length);
    push16(central, name.length); push16(central, 0); push16(central, 0); push16(central, 0); push16(central, 0); push32(central, 0); push32(central, offset);
    centralParts.push(new Uint8Array(central), name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = [];
  push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, files.size); push16(end, files.size);
  push32(end, centralSize); push32(end, offset); push16(end, 0);
  return concat([...localParts, ...centralParts, new Uint8Array(end)]);
}

function text(files, name) { return new TextDecoder("utf-8").decode(files.get(name) || new Uint8Array()); }
function setText(files, name, value) { files.set(name, new TextEncoder().encode(value)); }
function decodeXml(value) {
  return String(value || "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"").replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
function escapeXml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}
function columnIndex(ref) { return (String(ref || "").match(/[A-Z]+/i)?.[0] || "").toUpperCase().split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1; }
function columnName(index) {
  let value = Number(index) + 1;
  let name = "";
  while (value > 0) { const offset = (value - 1) % 26; name = String.fromCharCode(65 + offset) + name; value = Math.floor((value - 1) / 26); }
  return name;
}

function sharedStrings(xml) {
  return [...String(xml || "").matchAll(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/g)].map((match) =>
    [...match[0].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((part) => decodeXml(part[1])).join(""));
}

function cellValue(attrs, body, strings) {
  const inline = [...String(body || "").matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((part) => decodeXml(part[1])).join("");
  const raw = String(body || "").match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] || "";
  return /\bt="s"/.test(attrs) ? String(strings[Number(raw)] ?? "") : decodeXml(inline || raw);
}

function rowsFromSheet(xml, strings) {
  const rows = new Map();
  for (const rowMatch of String(xml || "").matchAll(/<(?:\w+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    const cells = new Map();
    for (const match of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*?\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = match[2];
      cells.set(columnIndex(ref), { ref, value: cellValue(match[1], match[3], strings) });
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

function normalized(value) { return String(value ?? "").replace(/[\s：:]/g, "").trim(); }
function relTarget(target) {
  const value = String(target || "").replace(/^\//, "").replace(/^\.\//, "");
  return value.startsWith("xl/") ? value : `xl/${value}`;
}

function workbookSheets(workbookXml, relsXml) {
  const relationships = new Map([...String(relsXml || "").matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)].map((match) => {
    const attrs = match[1] || "";
    return [attrs.match(/\bId="([^"]+)"/)?.[1] || "", attrs.match(/\bTarget="([^"]+)"/)?.[1] || ""];
  }));
  return [...String(workbookXml || "").matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map((match, index) => {
    const attrs = match[1] || "";
    const relationshipId = attrs.match(/\br:id="([^"]+)"/)?.[1] || "";
    return {
      name: decodeXml(attrs.match(/\bname="([^"]+)"/)?.[1] || `Sheet${index + 1}`),
      sheetId: Number(attrs.match(/\bsheetId="(\d+)"/)?.[1] || index + 1),
      relationshipId,
      path: relTarget(relationships.get(relationshipId) || `worksheets/sheet${index + 1}.xml`),
    };
  });
}

function inspectTemplateFiles(files) {
  const workbookXml = text(files, "xl/workbook.xml");
  const relsXml = text(files, "xl/_rels/workbook.xml.rels");
  const strings = sharedStrings(text(files, "xl/sharedStrings.xml"));
  for (const sheet of workbookSheets(workbookXml, relsXml)) {
    const sheetXml = text(files, sheet.path);
    if (!sheetXml) continue;
    const rows = rowsFromSheet(sheetXml, strings);
    for (const [rowNumber, cells] of [...rows].slice(0, 12)) {
      const values = [...cells.values()].map((cell) => normalized(cell.value));
      const moduleColumn = values.indexOf("模块");
      const focusColumn = values.indexOf("重点关注");
      const sequenceColumn = values.indexOf("序号");
      const questionColumn = values.indexOf("问题设置");
      if ([moduleColumn, focusColumn, sequenceColumn, questionColumn].some((value) => value < 0)) continue;
      const questions = [];
      let module = "";
      let focus = "";
      for (const [candidateRow, candidateCells] of rows) {
        if (candidateRow <= rowNumber) continue;
        const sequence = Number(String(candidateCells.get(sequenceColumn)?.value || "").trim());
        const question = String(candidateCells.get(questionColumn)?.value || "").trim();
        if (!Number.isFinite(sequence) || !question) continue;
        module = String(candidateCells.get(moduleColumn)?.value || module).trim();
        focus = String(candidateCells.get(focusColumn)?.value || focus).trim();
        questions.push({ row: candidateRow, sequence, module, focus, question: question.slice(0, MAX_CELL_CHARS) });
      }
      if (!questions.length) continue;
      const dimension = sheetXml.match(/<dimension\b[^>]*\bref="[A-Z]+\d+:([A-Z]+)(\d+)"/) || [];
      const maximumColumn = dimension[1] ? columnIndex(dimension[1]) : Math.max(...[...rows.values()].flatMap((row) => [...row.keys()]));
      const respondentStartColumn = questionColumn + 1;
      return {
        kind: "qualitative_summary_template",
        sheet_name: sheet.name,
        sheet_path: sheet.path,
        sheet_id: sheet.sheetId,
        relationship_id: sheet.relationshipId,
        header_row: rowNumber,
        label_row: Math.max(1, rowNumber - 1),
        module_column: moduleColumn,
        focus_column: focusColumn,
        sequence_column: sequenceColumn,
        question_column: questionColumn,
        respondent_start_column: respondentStartColumn,
        respondent_capacity: Math.max(1, maximumColumn - respondentStartColumn + 1),
        question_count: questions.length,
        questions,
      };
    }
  }
  return null;
}

export async function inspectQualitativeSummaryTemplate(arrayBuffer) {
  return inspectTemplateFiles(await readZip(arrayBuffer));
}

function stripCodeFence(value) {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  return start >= 0 && end > start ? source.slice(start, end + 1) : source;
}

export function parseQualitativeExcelHarnessReply(reply) {
  let parsed;
  try { parsed = JSON.parse(stripCodeFence(reply)); } catch { throw Object.assign(new Error("QUALITATIVE_EXCEL_JSON_INVALID"), { code: "QUALITATIVE_EXCEL_JSON_INVALID" }); }
  if (!parsed || !Array.isArray(parsed.respondents) || !parsed.respondents.length) throw Object.assign(new Error("QUALITATIVE_EXCEL_SCHEMA_INVALID"), { code: "QUALITATIVE_EXCEL_SCHEMA_INVALID" });
  return {
    respondents: parsed.respondents.slice(0, 40).map((respondent, index) => ({
      interview_id: String(respondent?.interview_id || "").trim().slice(0, 128),
      name: String(respondent?.name || `受访者${index + 1}`).trim().slice(0, 120),
      items: Array.isArray(respondent?.items) ? respondent.items.slice(0, 300).map((item) => ({
        sequence: Number(item?.sequence),
        coverage: String(item?.coverage || "covered").trim().toLowerCase(),
        summary: String(item?.summary || "").trim().slice(0, MAX_CELL_CHARS),
        evidence_refs: Array.isArray(item?.evidence_refs) ? item.evidence_refs.map((value) => String(value).trim().slice(0, 160)).filter(Boolean).slice(0, 8) : [],
      })).filter((item) => Number.isFinite(item.sequence)) : [],
    })),
  };
}

export function alignQualitativeExcelRespondents(result, interviews) {
  const respondents = Array.isArray(result?.respondents) ? result.respondents : [];
  const sources = Array.isArray(interviews) ? interviews : [];
  if (!respondents.length || respondents.length !== sources.length) throw Object.assign(new Error("QUALITATIVE_EXCEL_SCHEMA_INVALID"), { code: "QUALITATIVE_EXCEL_SCHEMA_INVALID" });
  const byId = new Map(respondents.filter((item) => item.interview_id).map((item) => [item.interview_id, item]));
  const canAlignById = byId.size === respondents.length && sources.every((file) => byId.has(String(file.id)));
  return {
    ...result,
    respondents: sources.map((file, index) => {
      const respondent = canAlignById ? byId.get(String(file.id)) : respondents[index];
      return { ...respondent, interview_id: String(file.id), name: respondent?.name || respondentName(file, index) };
    }),
  };
}

function respondentName(file, index) {
  const base = String(file?.file_name || "").replace(/\.[^.]+$/, "").replace(/(?:访谈|笔录|逐字稿|转写稿|录音转写)/g, " ").replace(/[【】()[\]_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || `受访者${index + 1}`).slice(0, 80);
}

export function buildQualitativeExcelPrompt({ project, template, interviews, userMessage, maxTranscriptChars = 90_000 }) {
  if (!template?.questions?.length) throw Object.assign(new Error("QUALITATIVE_EXCEL_TEMPLATE_INVALID"), { code: "QUALITATIVE_EXCEL_TEMPLATE_INVALID" });
  if (!Array.isArray(interviews) || !interviews.length) throw Object.assign(new Error("QUALITATIVE_EXCEL_INTERVIEWS_REQUIRED"), { code: "QUALITATIVE_EXCEL_INTERVIEWS_REQUIRED" });
  const perInterview = Math.max(4_000, Math.floor(Number(maxTranscriptChars || 90_000) / interviews.length));
  const questionRows = template.questions.map((item) => ({ sequence: item.sequence, module: item.module, focus: item.focus, question: item.question }));
  const transcriptBlocks = interviews.map((file, index) => {
    const source = String(file.parsed_text || "").trim();
    return `【访谈 ${index + 1}】\ninterview_id: ${file.id}\n建议姓名: ${respondentName(file, index)}\n文件名: ${file.file_name}\n笔录正文:\n${source.slice(0, perInterview)}`;
  });
  return [
    "你是 SurveyKit 的资深定性研究员。请把每份访谈笔录按给定 Excel 问题框架逐题归纳。",
    "只依据笔录，不得补造事实、频次、观点或原话。找不到证据时 coverage 必须为 not_covered，summary 必须为“本次访谈未涉及”。",
    "每个已覆盖单元格的 summary 使用适合直接写入 Excel 的中文：第一行以“• ”给出核心发现；必要时用“- ”补充细节；最后可放一条短原话并使用中文引号。不要输出 Markdown 表格。",
    "evidence_refs 填可回溯的位置，如“第12段”或简短原话开头；原话必须逐字来自当前受访者笔录。",
    "每位受访者必须返回框架中的全部序号且不得重复。name 优先使用笔录中明确的受访者姓名，否则使用建议姓名。",
    "仅输出一个合法 JSON 对象，不要代码围栏、解释或前后缀。结构严格为：",
    '{"respondents":[{"interview_id":"文件ID","name":"姓名","items":[{"sequence":1,"coverage":"covered|not_covered","summary":"• 核心发现\\n- 细节\\n“短原话”","evidence_refs":["第12段"]}]}]}',
    `【项目】\n名称：${String(project?.title || "未命名项目").slice(0, 200)}\n背景：${String(project?.brief || "未提供").slice(0, 2_000)}\n目标：${String(project?.research_goal || "未提供").slice(0, 2_000)}`,
    `【Excel 问题框架】\n${JSON.stringify(questionRows)}`,
    ...transcriptBlocks,
    `【用户补充要求】\n${String(userMessage || "按模板生成逐访谈 Excel 小结。").slice(0, 2_000)}`,
  ].join("\n\n");
}

function replaceCell(xml, ref, value) {
  const safeRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<c\\b([^>]*\\br="${safeRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const match = xml.match(expression);
  if (!match) return xml;
  const attributes = match[1].replace(/\s+t="[^"]*"/g, "");
  const cell = `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value ?? "").slice(0, MAX_CELL_CHARS))}</t></is></c>`;
  return xml.replace(expression, cell);
}

function cleanSummary(item) {
  if (!item || item.coverage === "not_covered" || !String(item.summary || "").trim()) return "本次访谈未涉及";
  const value = String(item.summary).trim().slice(0, MAX_CELL_CHARS);
  return /^[•·-]/.test(value) ? value : `• ${value}`;
}

function fillSheet(sourceXml, template, respondents, pageNumber) {
  let output = sourceXml;
  const capacity = template.respondent_capacity;
  const itemMaps = respondents.map((respondent) => new Map(respondent.items.map((item) => [Number(item.sequence), item])));
  for (let offset = 0; offset < capacity; offset += 1) {
    const column = columnName(template.respondent_start_column + offset);
    const respondent = respondents[offset];
    output = replaceCell(output, `${column}${template.label_row}`, respondent ? `用户${(pageNumber - 1) * capacity + offset + 1}` : "");
    output = replaceCell(output, `${column}${template.header_row}`, respondent?.name || "");
    for (const question of template.questions) output = replaceCell(output, `${column}${question.row}`, respondent ? cleanSummary(itemMaps[offset].get(question.sequence)) : "");
  }
  return output;
}

function safeSheetName(value) { return String(value || "用户访谈小结").replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "用户访谈小结"; }
function stripCloneRelationships(xml) {
  return String(xml || "").replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, "").replace(/<legacyDrawing\b[^>]*\/>/g, "");
}

function uniqueRelationshipId(xml, suffix) {
  let candidate = `rIdQualSummary${suffix}`;
  let index = suffix;
  while (new RegExp(`\\bId="${candidate}"`).test(xml)) { index += 1; candidate = `rIdQualSummary${index}`; }
  return candidate;
}

function uniqueSheetPath(files, suffix) {
  let index = suffix;
  let candidate = `xl/worksheets/qualitativeSummary${index}.xml`;
  while (files.has(candidate)) { index += 1; candidate = `xl/worksheets/qualitativeSummary${index}.xml`; }
  return candidate;
}

export async function fillQualitativeSummaryTemplate(arrayBuffer, harnessResult) {
  const files = await readZip(arrayBuffer);
  const template = inspectTemplateFiles(files);
  if (!template) throw Object.assign(new Error("QUALITATIVE_EXCEL_TEMPLATE_INVALID"), { code: "QUALITATIVE_EXCEL_TEMPLATE_INVALID" });
  const result = harnessResult?.respondents ? harnessResult : parseQualitativeExcelHarnessReply(harnessResult);
  if (!result.respondents.length) throw Object.assign(new Error("QUALITATIVE_EXCEL_SCHEMA_INVALID"), { code: "QUALITATIVE_EXCEL_SCHEMA_INVALID" });
  const sourceXml = text(files, template.sheet_path);
  const pages = Math.ceil(result.respondents.length / template.respondent_capacity);
  setText(files, template.sheet_path, fillSheet(sourceXml, template, result.respondents.slice(0, template.respondent_capacity), 1));
  if (pages > 1) {
    let workbookXml = text(files, "xl/workbook.xml");
    let relsXml = text(files, "xl/_rels/workbook.xml.rels");
    let contentTypesXml = text(files, "[Content_Types].xml");
    const existingSheets = workbookSheets(workbookXml, relsXml);
    let nextSheetId = Math.max(0, ...existingSheets.map((sheet) => sheet.sheetId)) + 1;
    for (let page = 2; page <= pages; page += 1) {
      const relationshipId = uniqueRelationshipId(relsXml, page);
      const sheetPath = uniqueSheetPath(files, page);
      const target = sheetPath.replace(/^xl\//, "");
      const sheetName = safeSheetName(`${template.sheet_name}_${page}`);
      const pageRespondents = result.respondents.slice((page - 1) * template.respondent_capacity, page * template.respondent_capacity);
      setText(files, sheetPath, fillSheet(stripCloneRelationships(sourceXml), template, pageRespondents, page));
      workbookXml = workbookXml.replace(/<\/sheets>/, `<sheet name="${escapeXml(sheetName)}" sheetId="${nextSheetId}" r:id="${relationshipId}"/></sheets>`);
      relsXml = relsXml.replace(/<\/Relationships>/, `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${escapeXml(target)}"/></Relationships>`);
      contentTypesXml = contentTypesXml.replace(/<\/Types>/, `<Override PartName="/${escapeXml(sheetPath)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
      nextSheetId += 1;
    }
    setText(files, "xl/workbook.xml", workbookXml);
    setText(files, "xl/_rels/workbook.xml.rels", relsXml);
    setText(files, "[Content_Types].xml", contentTypesXml);
  }
  return { bytes: writeZip(files), template, respondent_count: result.respondents.length, sheet_count: pages };
}

export const qualitativeExcelInternals = { readZip, writeZip, rowsFromSheet, workbookSheets };
