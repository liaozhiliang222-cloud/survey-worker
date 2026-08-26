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

const EXCEL_STYLE_IDS = {
  percent: "Percent1", bold: "Bold", header: "Header", top2: "Top2", bottom2: "Bottom2", base: "Base",
  crosstabCaption: "CrosstabCaption", crosstabHeaderTop: "CrosstabHeaderTop", crosstabHeaderMid: "CrosstabHeaderMid",
  crosstabHeaderBottom: "CrosstabHeaderBottom", crosstabSigLetters: "CrosstabSigLetters", crosstabBase: "CrosstabBase",
  crosstabRowLabel: "CrosstabRowLabel", crosstabNetLabel: "CrosstabNetLabel", directoryTitle: "DirectoryTitle",
  directorySection: "DirectorySection", directoryHeader: "DirectoryHeader", directoryBody: "DirectoryBody", directoryLink: "DirectoryLink"
};

function excelXmlCell(value) {
  const cell = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  const mappedStyle = cell.format && EXCEL_STYLE_IDS[cell.format];
  const styleId = mappedStyle ? ` ss:StyleID="${mappedStyle}"` : "";
  const mergeAcross = Number.isInteger(cell.mergeAcross) && cell.mergeAcross > 0 ? ` ss:MergeAcross="${cell.mergeAcross}"` : "";
  const index = Number.isInteger(cell.index) && cell.index > 0 ? ` ss:Index="${cell.index}"` : "";
  const href = cell.href ? ` ss:HRef="${escapeHtml(cell.href)}"` : "";
  if (cell.type === "number") {
    return `<Cell${index}${href}${styleId}${mergeAcross}><Data ss:Type="Number">${cell.value ?? 0}</Data></Cell>`;
  }
  const text = String(cell.value ?? "");
  const numeric = text !== "" && Number.isFinite(Number(text)) && !/%$/.test(text);
  const type = numeric ? "Number" : "String";
  return `<Cell${index}${href}${styleId}${mergeAcross}><Data ss:Type="${type}">${escapeHtml(text)}</Data></Cell>`;
}

function excelXmlRow(row) {
  const definition = Array.isArray(row) ? { cells: row } : (row || { cells: [] });
  const cells = Array.isArray(definition.cells) ? definition.cells : [];
  const height = Number.isFinite(definition.height) && definition.height > 0 ? ` ss:AutoFitHeight="0" ss:Height="${definition.height}"` : "";
  const mappedStyle = definition.format && EXCEL_STYLE_IDS[definition.format];
  const styleId = mappedStyle ? ` ss:StyleID="${mappedStyle}"` : "";
  return `<Row${height}${styleId}>${cells.map(excelXmlCell).join("")}</Row>`;
}

function excelWorksheetColumnsXml(sheet) {
  if (Array.isArray(sheet.columns) && sheet.columns.length) {
    return sheet.columns.map((column) => {
      const index = Number.isInteger(column.index) && column.index > 0 ? ` ss:Index="${column.index}"` : "";
      const width = Number.isFinite(column.width) && column.width > 0 ? ` ss:Width="${column.width}"` : "";
      const span = Number.isInteger(column.span) && column.span > 0 ? ` ss:Span="${column.span}"` : "";
      return `<Column${index} ss:AutoFitWidth="0"${width}${span}/>`;
    }).join("");
  }
  const columnCount = Math.max(1, Number(sheet.columnCount) || 1);
  if (sheet.kind === "crosstab") {
    const dataColumns = Math.max(0, columnCount - 2);
    return `<Column ss:Index="1" ss:AutoFitWidth="0" ss:Width="92"/><Column ss:Index="2" ss:AutoFitWidth="0" ss:Width="92"/>${dataColumns ? `<Column ss:Index="3" ss:AutoFitWidth="0" ss:Width="58"${dataColumns > 1 ? ` ss:Span="${dataColumns - 1}"` : ""}/>` : ""}`;
  }
  if (sheet.kind === "directory") {
    return `<Column ss:Index="1" ss:AutoFitWidth="0" ss:Width="260"/><Column ss:Index="2" ss:AutoFitWidth="0" ss:Width="105"/><Column ss:Index="3" ss:AutoFitWidth="0" ss:Width="72" ss:Span="2"/>`;
  }
  return "";
}

function excelWorksheetOptionsXml(sheet) {
  if (sheet.showGridlines !== false && sheet.kind !== "crosstab" && sheet.kind !== "directory") return "";
  return `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DoNotDisplayGridlines/><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>`;
}

function excelWorkbookStylesXml() {
  return `<Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="11"/></Style>
    <Style ss:ID="Percent1"><NumberFormat ss:Format="0.0%"/></Style>
    <Style ss:ID="Bold"><Font ss:FontName="Arial" ss:Size="11" ss:Bold="1"/></Style>
    <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4472C4" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Top2"><Interior ss:Color="#C6EFCE" ss:Pattern="Solid"/><Font ss:Color="#006100"/></Style>
    <Style ss:ID="Bottom2"><Interior ss:Color="#FFC7CE" ss:Pattern="Solid"/><Font ss:Color="#9C0006"/></Style>
    <Style ss:ID="Base"><Font ss:FontName="Arial" ss:Size="10" ss:Italic="1" ss:Color="#666666"/></Style>
    <Style ss:ID="CrosstabCaption"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#1F4E78"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E78" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabHeaderTop"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4472C4" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabHeaderMid"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#9DC3E6" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabHeaderBottom"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="9" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabSigLetters"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#EAF2F8" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabBase"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#70AD47"/></Borders><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#375623"/><Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabRowLabel"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E7EDF3"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Color="#334155"/><Interior ss:Color="#F7F9FC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabNetLabel"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#EAF2F8" ss:Pattern="Solid"/></Style>
    <Style ss:ID="DirectoryTitle"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="15" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E78" ss:Pattern="Solid"/></Style>
    <Style ss:ID="DirectorySection"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="11" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="DirectoryHeader"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4472C4" ss:Pattern="Solid"/></Style>
    <Style ss:ID="DirectoryBody"><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Color="#334155"/></Style>
    <Style ss:ID="DirectoryLink"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2F3"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Color="#0563C1" ss:Underline="Single"/></Style>
  </Styles>`;
}

export function excelSafeSheetName(name, fallback = "Sheet1") {
  return String(name || fallback).replace(/[\\/?*[\]:]/g, "").slice(0, 31) || fallback;
}

export function buildExcelWorkbookXml(sheets) {
  const worksheets = sheets.map((sheet, index) => {
    const sheetName = excelSafeSheetName(sheet.name, `Sheet${index + 1}`);
    const rowXml = (sheet.rows || []).map(excelXmlRow).join("");
    return `<Worksheet ss:Name="${escapeHtml(sheetName)}"><Table ss:DefaultRowHeight="18">${excelWorksheetColumnsXml(sheet)}${rowXml}</Table>${excelWorksheetOptionsXml(sheet)}</Worksheet>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${excelWorkbookStylesXml()}${worksheets}</Workbook>`;
}

export function downloadExcelXml(filename, sheetName, rows, options = {}) {
  const xml = buildExcelWorkbookXml([{ ...options, name: excelSafeSheetName(sheetName), rows }]);
  downloadTextFile(filename, xml, "application/octet-stream;charset=utf-8");
}

export function downloadExcelFromRows(filename, rows, sheetName = "Sheet1", options = {}) {
  downloadExcelXml(filename, sheetName, rows, options);
}

export function downloadExcelWorkbookXml(filename, sheets) {
  downloadTextFile(filename, buildExcelWorkbookXml(sheets), "application/octet-stream;charset=utf-8");
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
