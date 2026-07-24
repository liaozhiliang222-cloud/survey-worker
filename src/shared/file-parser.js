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
    .replaceAll("&apos;", "'");
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
  if (entry.compression === 0) return uint8ToString(entry.data);
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

// ─── SAV 解析 ───────────────────────────────────────────────

export function decodeSavText(bytes) {
  const cleaned = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = cleaned.findIndex((byte) => byte === 0);
  const slice = cleaned.slice(0, end >= 0 ? end : cleaned.length);
  try {
    const utf8 = new TextDecoder("utf-8").decode(slice).trim();
    if (!utf8.includes("")) return utf8;
    return new TextDecoder("gb18030").decode(slice).trim();
  } catch {
    return new TextDecoder("gb18030").decode(slice).trim();
  }
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
        pendingLabels.push({ valueBytes, label });
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
        });
      });
      pendingLabels = null;
    } else if (recordType === 6) {
      const lineCount = readInt();
      offset += lineCount * 80;
    } else if (recordType === 7) {
      readInt();
      const size = readInt();
      const count = readInt();
      offset += size * count;
    } else if (recordType === 999) {
      offset += 4;
      break;
    } else {
      throw new Error(`暂不支持的 SAV 字典记录类型：${recordType}`);
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
    while (offset < bytes.length) {
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
