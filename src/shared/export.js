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
    <Style ss:ID="CrosstabHeaderTop"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabHeaderMid"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabHeaderBottom"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/></Borders><Font ss:FontName="Microsoft YaHei" ss:Size="9" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabSigLetters"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B4C6D7"/></Borders><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#17365D"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="CrosstabBase"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9C1"/></Borders><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#375623"/><Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/></Style>
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

const XLSX_STYLE_INDEX = {
  netPercent: 20, netNumber: 21,
  percent: 1, bold: 2, header: 3, top2: 4, bottom2: 5, base: 6,
  crosstabCaption: 7, crosstabHeaderTop: 8, crosstabHeaderMid: 9,
  crosstabHeaderBottom: 10, crosstabSigLetters: 11, crosstabBase: 12,
  crosstabRowLabel: 13, crosstabNetLabel: 14, directoryTitle: 15,
  directorySection: 16, directoryHeader: 17, directoryBody: 18, directoryLink: 19
};

function excelXlsxColumnName(index) {
  let name = "";
  let value = Math.max(1, Number(index) || 1);
  while (value > 0) {
    const offset = (value - 1) % 26;
    name = String.fromCharCode(65 + offset) + name;
    value = Math.floor((value - offset) / 26);
  }
  return name;
}

function excelXlsxCellRef(column, row) {
  return `${excelXlsxColumnName(column)}${row}`;
}

function excelXlsxColumnsXml(sheet) {
  const definitions = Array.isArray(sheet.columns) && sheet.columns.length
    ? sheet.columns
    : sheet.kind === "crosstab"
      ? [
          { index: 1, width: 92 },
          { index: 2, width: 92 },
          ...(Math.max(0, Number(sheet.columnCount) - 2) ? [{ index: 3, width: 58, span: Math.max(0, Number(sheet.columnCount) - 3) }] : [])
        ]
      : sheet.kind === "directory"
        ? [{ index: 1, width: 260 }, { index: 2, width: 105 }, { index: 3, width: 72, span: 2 }]
        : [];
  if (!definitions.length) return "";
  return `<cols>${definitions.map((column) => {
    const min = Math.max(1, Number(column.index) || 1);
    const max = min + Math.max(0, Number(column.span) || 0);
    const width = Math.max(1, Number(column.width) || 64) / 7;
    return `<col min="${min}" max="${max}" width="${width.toFixed(2)}" customWidth="1"/>`;
  }).join("")}</cols>`;
}

function excelXlsxSheetXml(sheet) {
  const merges = [];
  const hyperlinks = [];
  let maxColumn = Math.max(1, Number(sheet.columnCount) || 1);
  const rows = (sheet.rows || []).map((row, rowIndex) => {
    const definition = Array.isArray(row) ? { cells: row } : (row || { cells: [] });
    const cells = Array.isArray(definition.cells) ? definition.cells : [];
    const rowNumber = rowIndex + 1;
    let column = 1;
    const cellXml = cells.map((rawCell) => {
      const cell = rawCell && typeof rawCell === "object" && !Array.isArray(rawCell) ? rawCell : { value: rawCell };
      if (Number.isInteger(cell.index) && cell.index > 0) column = cell.index;
      const ref = excelXlsxCellRef(column, rowNumber);
      const mergeAcross = Number.isInteger(cell.mergeAcross) && cell.mergeAcross > 0 ? cell.mergeAcross : 0;
      if (mergeAcross) merges.push(`${ref}:${excelXlsxCellRef(column + mergeAcross, rowNumber)}`);
      if (cell.href) hyperlinks.push({ ref, location: String(cell.href).replace(/^#/, ""), display: String(cell.value ?? "") });
      const style = XLSX_STYLE_INDEX[cell.format || definition.format] ?? 0;
      const value = cell.value ?? "";
      const numeric = cell.type === "number"
        || typeof value === "number"
        || (String(value).trim() !== "" && Number.isFinite(Number(value)) && !/%$/.test(String(value)));
      const xml = numeric
        ? `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${Number(value) || 0}</v></c>`
        : `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeHtml(value)}</t></is></c>`;
      // Materialize merged header cells so Excel/WPS retain the full border perimeter.
      const mergedHeaderXml = [8, 9, 10, 12].includes(style)
        ? Array.from({ length: mergeAcross }, (_, offset) => `<c r="${excelXlsxCellRef(column + offset + 1, rowNumber)}" s="${style}"/>`).join("")
        : "";
      column += mergeAcross + 1;
      maxColumn = Math.max(maxColumn, column - 1);
      return xml + mergedHeaderXml;
    }).join("");
    const height = Number.isFinite(definition.height) && definition.height > 0
      ? ` ht="${definition.height}" customHeight="1"`
      : "";
    return `<row r="${rowNumber}"${height}>${cellXml}</row>`;
  }).join("");
  const lastRow = Math.max(1, (sheet.rows || []).length);
  const showGridLines = sheet.showGridlines === false || ["crosstab", "directory"].includes(sheet.kind) ? ' showGridLines="0"' : "";
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const hyperlinkXml = hyperlinks.length ? `<hyperlinks>${hyperlinks.map((item) => `<hyperlink ref="${item.ref}" location="${escapeHtml(item.location)}" display="${escapeHtml(item.display)}"/>`).join("")}</hyperlinks>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${excelXlsxCellRef(maxColumn, lastRow)}"/><sheetViews><sheetView workbookViewId="0"${showGridLines}/></sheetViews><sheetFormatPr defaultRowHeight="18"/>${excelXlsxColumnsXml(sheet)}<sheetData>${rows}</sheetData>${mergeXml}${hyperlinkXml}</worksheet>`;
}

function excelXlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="16"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font><font><color rgb="FF006100"/><sz val="11"/><name val="Arial"/></font><font><color rgb="FF9C0006"/><sz val="11"/><name val="Arial"/></font><font><i/><color rgb="FF666666"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF17365D"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF17365D"/><sz val="9"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF17365D"/><sz val="9"/><name val="Arial"/></font><font><b/><color rgb="FF375623"/><sz val="10"/><name val="Arial"/></font><font><color rgb="FF334155"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FF17365D"/><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="15"/><name val="Microsoft YaHei"/></font><font><u/><color rgb="FF0563C1"/><sz val="10"/><name val="Microsoft YaHei"/></font></fonts><fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9DC3E6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="7"><border/><border><left/><right/><top/><bottom style="medium"><color rgb="FF1F4E78"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF8EA9C1"/></left><right style="thin"><color rgb="FF8EA9C1"/></right><top style="thin"><color rgb="FF8EA9C1"/></top><bottom style="thin"><color rgb="FF8EA9C1"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FF8EA9C1"/></left><right style="thin"><color rgb="FF8EA9C1"/></right><top style="thin"><color rgb="FF8EA9C1"/></top><bottom style="thin"><color rgb="FF8EA9C1"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE7EDF3"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB4C6D7"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="22"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="8" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="8" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="9" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="10" fillId="7" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="11" fillId="9" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="12" fillId="10" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="13" fillId="8" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="14" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="13" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="7" fillId="2" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="12" fillId="0" borderId="6" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="15" fillId="0" borderId="6" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="13" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="13" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

// ZIP 校验表复用，避免对文件中的每个字节重复计算 8 次多项式。
const excelCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function excelZipCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ excelCrcTable[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function excelZipUint16(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function excelZipUint32(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function excelZipConcat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

function createExcelZipBytes(entries, onProgress) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry, index) => {
    onProgress?.({ phase: "zip", current: index + 1, total: entries.length, name: entry.name });
    const name = encoder.encode(entry.name);
    const data = entry.content instanceof Uint8Array ? entry.content : encoder.encode(String(entry.content ?? ""));
    const crc = excelZipCrc32(data);
    const local = [];
    excelZipUint32(local, 0x04034b50); excelZipUint16(local, 20); excelZipUint16(local, 0x0800); excelZipUint16(local, 0);
    excelZipUint16(local, 0); excelZipUint16(local, 0); excelZipUint32(local, crc); excelZipUint32(local, data.length); excelZipUint32(local, data.length);
    excelZipUint16(local, name.length); excelZipUint16(local, 0);
    localParts.push(new Uint8Array(local), name, data);
    const central = [];
    excelZipUint32(central, 0x02014b50); excelZipUint16(central, 20); excelZipUint16(central, 20); excelZipUint16(central, 0x0800); excelZipUint16(central, 0);
    excelZipUint16(central, 0); excelZipUint16(central, 0); excelZipUint32(central, crc); excelZipUint32(central, data.length); excelZipUint32(central, data.length);
    excelZipUint16(central, name.length); excelZipUint16(central, 0); excelZipUint16(central, 0); excelZipUint16(central, 0); excelZipUint16(central, 0);
    excelZipUint32(central, 0); excelZipUint32(central, offset);
    centralParts.push(new Uint8Array(central), name);
    offset += local.length + name.length + data.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  excelZipUint32(end, 0x06054b50); excelZipUint16(end, 0); excelZipUint16(end, 0); excelZipUint16(end, entries.length); excelZipUint16(end, entries.length);
  excelZipUint32(end, centralSize); excelZipUint32(end, offset); excelZipUint16(end, 0);
  return excelZipConcat([...localParts, ...centralParts, new Uint8Array(end)]);
}

export function buildExcelWorkbookXlsxBytes(sheets, onProgress) {
  const safeSheets = (sheets || []).map((sheet, index) => ({ ...sheet, name: excelSafeSheetName(sheet.name, `Sheet${index + 1}`) }));
  const sheetOverrides = safeSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = safeSheets.map((sheet, index) => `<sheet name="${escapeHtml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const worksheetRelationships = safeSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const styleRelationshipId = safeSheets.length + 1;
  return createExcelZipBytes([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}<Relationship Id="rId${styleRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: excelXlsxStylesXml() },
    ...safeSheets.map((sheet, index) => {
      onProgress?.({ phase: "sheet", current: index + 1, total: safeSheets.length, name: sheet.name });
      return { name: `xl/worksheets/sheet${index + 1}.xml`, content: excelXlsxSheetXml(sheet) };
    })
  ], onProgress);
}

// 提前建立空闲后台任务；点击生成时先确认就绪，避免末尾再加载 Worker 模块。
let preparedExcelWorker = null;
export function prepareExcelWorkbookExport() {
  if (typeof Worker === "undefined") return Promise.resolve(null);
  if (!preparedExcelWorker) {
    const pending = new Promise((resolve, reject) => {
      let worker;
      let timer;
      const fail = error => { clearTimeout(timer); worker?.terminate(); reject(error); };
      try {
        worker = new Worker(new URL("./excel-export-worker.js?v=20260908-1", import.meta.url), { type: "module" });
        timer = setTimeout(() => fail(new Error("Excel 后台工具加载超时，请检查网络后重试。")), 45000);
        worker.onerror = () => fail(new Error("Excel 后台工具加载失败，请刷新页面后重试。"));
        worker.onmessage = ({data}) => {
          if (data.type === "ready") { clearTimeout(timer); worker.onmessage = null; resolve(worker); }
        };
      } catch (error) { fail(error); }
    });
    preparedExcelWorker = pending;
    pending.catch(() => { if (preparedExcelWorker === pending) preparedExcelWorker = null; });
  }
  return preparedExcelWorker;
}

/** 独立后台任务，完成后转移字节缓冲，避免页面主线程打包大工作簿。 */
export async function buildExcelWorkbookXlsxBytesAsync(sheets, onProgress) {
  if (typeof Worker === "undefined") return buildExcelWorkbookXlsxBytes(sheets, onProgress);
  const preparation = prepareExcelWorkbookExport();
  preparedExcelWorker = null; // 每次调用独占一个 Worker，不与其他导出共享事件处理器。
  const worker = await preparation;
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, bytes) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(bytes);
    };
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error("Excel 文件打包超时，请减少表头列后重试。")), 180000);
    };
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") { armTimeout(); onProgress?.(data.progress); }
      else if (data.type === "result") finish(null, new Uint8Array(data.buffer));
      else if (data.type === "error") finish(new Error(data.message));
    };
    worker.onerror = () => finish(new Error("Excel 后台打包失败，请重试。"));
    worker.onmessageerror = () => finish(new Error("Excel 文件传输失败，请重试。"));
    try { armTimeout(); worker.postMessage({ sheets }); }
    catch (error) { finish(error); }
  });
}

export function downloadExcelXml(filename, sheetName, rows, options = {}) {
  const bytes = buildExcelWorkbookXlsxBytes([{ ...options, name: excelSafeSheetName(sheetName), rows }]);
  downloadBlob(filename, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export function downloadExcelFromRows(filename, rows, sheetName = "Sheet1", options = {}) {
  downloadExcelXml(filename, sheetName, rows, options);
}

export function downloadExcelWorkbookXml(filename, sheets) {
  const bytes = buildExcelWorkbookXlsxBytes(sheets);
  downloadBlob(filename, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
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
