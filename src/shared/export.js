/**
 * 文件导出工具 — CSV / Excel XML / 文本 / Blob / SVG→PNG
 * Phase 2 增强：SPSS 兼容导出、多 Sheet 工作簿、SVG 字符串转 PNG
 */

export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([`\ufeff${content}`], { type });
  downloadBlob(filename, blob);
}

export function downloadCsv(filename, rows) {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

// ─── Excel XML 导出 ─────────────────────────────────────────

function excelXmlCell(value) {
  const cell = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { value };
  const styleId = cell.format === "percent" ? ` ss:StyleID="Percent1"` : cell.format === "bold" ? ` ss:StyleID="Bold"` : "";
  if (cell.type === "number") {
    const href = cell.href ? ` ss:HRef="${escapeHtml(cell.href)}"` : "";
    return `<Cell${href}${styleId}><Data ss:Type="Number">${cell.value ?? 0}</Data></Cell>`;
  }
  const text = String(cell.value ?? "");
  const numeric = text !== "" && Number.isFinite(Number(text)) && !/%$/.test(text);
  const type = numeric ? "Number" : "String";
  const href = cell.href ? ` ss:HRef="${escapeHtml(cell.href)}"` : "";
  return `<Cell${href}${styleId}><Data ss:Type="${type}">${escapeHtml(text)}</Data></Cell>`;
}

function excelWorkbookStylesXml() {
  return `<Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="11"/>
    </Style>
    <Style ss:ID="Percent1">
      <NumberFormat ss:Format="0.0%"/>
    </Style>
    <Style ss:ID="Bold">
      <Font ss:FontName="Arial" ss:Size="11" ss:Bold="1"/>
    </Style>
  </Styles>`;
}

export function excelSafeSheetName(name, fallback = "Sheet1") {
  return String(name || fallback).replace(/[\\/?*[\]:]/g, "").slice(0, 31) || fallback;
}

export function downloadExcelXml(filename, sheetName, rows) {
  const safeSheetName = excelSafeSheetName(sheetName);
  const rowXml = rows.map((row) => `<Row>${row.map(excelXmlCell).join("")}</Row>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${excelWorkbookStylesXml()}
  <Worksheet ss:Name="${escapeHtml(safeSheetName)}">
    <Table>${rowXml}</Table>
  </Worksheet>
</Workbook>`;
  downloadTextFile(filename, xml, "application/octet-stream;charset=utf-8");
}

export function downloadExcelFromRows(filename, rows, sheetName = "Sheet1") {
  downloadExcelXml(filename, sheetName, rows);
}

export function downloadExcelWorkbookXml(filename, sheets) {
  const worksheets = sheets.map((sheet, index) => {
    const sheetName = excelSafeSheetName(sheet.name, `Sheet${index + 1}`);
    const rowXml = sheet.rows.map((row) => `<Row>${row.map(excelXmlCell).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${escapeHtml(sheetName)}"><Table>${rowXml}</Table></Worksheet>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${excelWorkbookStylesXml()}
${worksheets}
</Workbook>`;
  downloadTextFile(filename, xml, "application/octet-stream;charset=utf-8");
}

// ─── SVG → PNG 导出 ─────────────────────────────────────────

export function exportSvgChartAsPng(containerSelector, filename) {
  const svg = document.querySelector(`${containerSelector} svg`);
  if (!svg) return;
  svgElementToPng(svg, filename);
}

/**
 * Phase 2: SVG 元素转 PNG 下载
 */
export function svgElementToPng(svg, filename, scale = 2) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = clone.getAttribute("viewBox")?.split(/\s+/).map(Number) || [];
  const width = viewBox[2] || svg.clientWidth || 900;
  const height = viewBox[3] || svg.clientHeight || 520;
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  svgStringToPng(new XMLSerializer().serializeToString(clone), filename, width, height, scale);
}

/**
 * Phase 2: SVG 字符串转 PNG 下载
 */
export function svgStringToPng(svgString, filename, width = 900, height = 520, scale = 2) {
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(filename, blob);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

// ─── Phase 2: SPSS 兼容导出 ─────────────────────────────────

/**
 * 导出 SPSS 兼容 CSV（带变量标签行）
 * @param {string} filename - 文件名
 * @param {string[]} headers - 变量名
 * @param {string[]} labels - 变量标签（中文描述）
 * @param {Array<Array>} rows - 数据行
 */
export function downloadSpssCompatibleCsv(filename, headers, labels, rows) {
  const headerLine = headers.map(csvCell).join(",");
  const labelLine = (labels || headers).map(csvCell).join(",");
  const dataLines = rows.map((row) => row.map(csvCell).join(","));
  const content = [headerLine, `LABEL:${labelLine}`, ...dataLines].join("\r\n");
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

/**
 * Phase 2: 导出带编码本的多 Sheet Excel
 * @param {string} filename - 文件名
 * @param {object} options - { dataRows, dataHeaders, codebook }
 *   codebook: Array<{ variable, label, type, values }>
 */
export function downloadExcelWithCodebook(filename, options = {}) {
  const { dataRows = [], dataHeaders = [], codebook = [] } = options;
  const sheets = [];

  // 数据 Sheet
  if (dataHeaders.length) {
    sheets.push({
      name: "数据",
      rows: [dataHeaders.map((h) => ({ value: h, format: "bold" })), ...dataRows]
    });
  }

  // 编码本 Sheet
  if (codebook.length) {
    const codebookHeader = ["变量名", "标签", "类型", "值域/选项"].map((h) => ({ value: h, format: "bold" }));
    const codebookRows = codebook.map((item) => [
      item.variable || "",
      item.label || "",
      item.type || "",
      item.values || ""
    ]);
    sheets.push({ name: "编码本", rows: [codebookHeader, ...codebookRows] });
  }

  if (sheets.length) {
    downloadExcelWorkbookXml(filename, sheets);
  }
}
