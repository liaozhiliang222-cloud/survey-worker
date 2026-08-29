/** Browser-side DOCX export for completed AI Researcher replies. */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CONTENT_WIDTH_DXA = 9360;

function xmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function sanitizeDocxFilename(value) {
  const safe = String(value || "AI研究成果").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return (safe || "AI研究成果").slice(0, 100);
}

function inlineRuns(text, extra = "") {
  const source = String(text ?? "");
  const runs = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) runs.push(run(source.slice(cursor, match.index), extra));
    const token = match[0];
    if (token.startsWith("**")) runs.push(run(token.slice(2, -2), `${extra}<w:b/>`));
    else if (token.startsWith("*")) runs.push(run(token.slice(1, -1), `${extra}<w:i/>`));
    else runs.push(run(token.slice(1, -1), `${extra}<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F2F4F7"/>`));
    cursor = match.index + token.length;
  }
  if (cursor < source.length) runs.push(run(source.slice(cursor), extra));
  return runs.join("") || run("", extra);
}

function run(text, properties = "") {
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function paragraph(text, { style = "Normal", numId = 0, level = 0, extraPPr = "", runProps = "" } = {}) {
  const numbering = numId ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>` : "";
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${numbering}${extraPPr}</w:pPr>${inlineRuns(text, runProps)}</w:p>`;
}

function parseTable(lines, start) {
  const rows = [];
  let index = start;
  while (index < lines.length && /^\s*\|/.test(lines[index])) {
    const cells = lines[index].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
    index += 1;
  }
  return { rows, nextIndex: index };
}

function table(rows) {
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const base = Math.floor(CONTENT_WIDTH_DXA / columns);
  const widths = Array.from({ length: columns }, (_, index) => index === columns - 1 ? CONTENT_WIDTH_DXA - base * (columns - 1) : base);
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const rowXml = rows.map((row, rowIndex) => `<w:tr>${widths.map((width, columnIndex) => {
    const header = rowIndex === 0;
    const fill = header ? '<w:shd w:fill="E8EEF5"/>' : "";
    const content = inlineRuns(row[columnIndex] || "", header ? "<w:b/>" : "");
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="60" w:line="280" w:lineRule="auto"/></w:pPr>${content}</w:p></w:tc>`;
  }).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH_DXA}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B9C7D8"/><w:left w:val="single" w:sz="4" w:color="B9C7D8"/><w:bottom w:val="single" w:sz="4" w:color="B9C7D8"/><w:right w:val="single" w:sz="4" w:color="B9C7D8"/><w:insideH w:val="single" w:sz="4" w:color="D8E0EA"/><w:insideV w:val="single" w:sz="4" w:color="D8E0EA"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`;
}

function titleAndBody(content, fallbackTitle) {
  const lines = String(content ?? "").split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim());
  if (first >= 0) {
    const heading = lines[first].trim().match(/^#{1,2}\s+(.+)$/);
    if (heading) {
      lines.splice(first, 1);
      return { title: heading[1].replace(/\*\*/g, "").trim(), lines };
    }
  }
  return { title: fallbackTitle || "AI研究成果", lines };
}

export function markdownToWordDocumentXml(content, options = {}) {
  const { title, lines } = titleAndBody(content, options.title || options.projectTitle);
  const exportedAt = options.exportedAt instanceof Date ? options.exportedAt : new Date(options.exportedAt || Date.now());
  const dateLabel = Number.isNaN(exportedAt.valueOf()) ? "" : exportedAt.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  const project = options.projectTitle || "AI研究项目";
  const body = [
    paragraph("AI RESEARCHER", { style: "Kicker" }),
    paragraph(title, { style: "DocumentTitle" }),
    paragraph(`项目：${project}${dateLabel ? `  |  导出日期：${dateLabel}` : ""}`, { style: "Metadata" }),
    '<w:p><w:pPr><w:spacing w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="10" w:space="6" w:color="2E74B5"/></w:pBdr></w:pPr></w:p>',
  ];
  let blankPending = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) { blankPending = body.length > 4; continue; }
    if (blankPending) { body.push(paragraph("")); blankPending = false; }
    if (/^---+$/.test(line)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D8E0EA"/></w:pBdr></w:pPr></w:p>'); continue; }
    if (/^\|/.test(line)) { const parsed = parseTable(lines, index); if (parsed.rows.length) body.push(table(parsed.rows)); index = parsed.nextIndex - 1; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = Math.min(3, heading[1].length); body.push(paragraph(heading[2], { style: `Heading${level}` })); continue; }
    const ordered = line.match(/^(\d+)[.)、]\s+(.+)$/);
    if (ordered) { body.push(paragraph(ordered[2], { style: "ListParagraph", numId: 2 })); continue; }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) { body.push(paragraph(bullet[1], { style: "ListParagraph", numId: 1 })); continue; }
    const quote = line.match(/^>\s*(.+)$/);
    if (quote) { body.push(paragraph(quote[1], { style: "Quote" })); continue; }
    body.push(paragraph(line));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="DocumentTitle"><w:name w:val="Document Title"/><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="52"/><w:color w:val="0B2545"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Kicker"><w:name w:val="Kicker"/><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="18"/><w:color w:val="2E74B5"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:sz w:val="19"/><w:color w:val="667085"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2E74B5"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2E74B5"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="1F4D78"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="540" w:hanging="270"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="120"/><w:ind w:left="360" w:right="240"/><w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="2E74B5"/></w:pBdr><w:shd w:fill="F4F6F9"/></w:pPr><w:rPr><w:i/><w:color w:val="344054"/></w:rPr></w:style></w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function push16(list, value) { list.push(value & 0xff, (value >>> 8) & 0xff); }
function push32(list, value) { list.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function zipBytes(entries) {
  const encoder = new TextEncoder(); const localParts = []; const centralParts = []; let offset = 0;
  for (const entry of entries) { const name = encoder.encode(entry.name); const data = entry.content instanceof Uint8Array ? entry.content : encoder.encode(String(entry.content)); const crc = crc32(data); const local = []; push32(local, 0x04034b50); push16(local, 20); push16(local, 0x0800); push16(local, 0); push16(local, 0); push16(local, 0); push32(local, crc); push32(local, data.length); push32(local, data.length); push16(local, name.length); push16(local, 0); localParts.push(new Uint8Array(local), name, data); const central = []; push32(central, 0x02014b50); push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0); push16(central, 0); push16(central, 0); push32(central, crc); push32(central, data.length); push32(central, data.length); push16(central, name.length); push16(central, 0); push16(central, 0); push16(central, 0); push16(central, 0); push32(central, 0); push32(central, offset); centralParts.push(new Uint8Array(central), name); offset += local.length + name.length + data.length; }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0); const end = []; push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, entries.length); push16(end, entries.length); push32(end, centralSize); push32(end, offset); push16(end, 0); const parts = [...localParts, ...centralParts, new Uint8Array(end)]; const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let position = 0; for (const part of parts) { output.set(part, position); position += part.length; } return output;
}

export function buildAiResearchDocxBytes(options = {}) {
  const now = options.exportedAt instanceof Date ? options.exportedAt : new Date(options.exportedAt || Date.now());
  const iso = Number.isNaN(now.valueOf()) ? new Date(0).toISOString() : now.toISOString();
  const entries = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>` },
    { name: "word/styles.xml", content: stylesXml }, { name: "word/numbering.xml", content: numberingXml },
    { name: "word/document.xml", content: markdownToWordDocumentXml(options.content, options) },
    { name: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title || options.projectTitle || "AI研究成果")}</dc:title><dc:creator>SurveyKit AI Researcher</dc:creator><cp:lastModifiedBy>SurveyKit AI Researcher</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SurveyKit</Application></Properties>` },
  ];
  return zipBytes(entries);
}

export function buildAiResearchDocxBlob(options = {}) { return new Blob([buildAiResearchDocxBytes(options)], { type: DOCX_MIME }); }

