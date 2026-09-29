const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.goto("/#ai-assistant");
  await page.waitForFunction(() => typeof documentImportFileToText === "function");
});

async function workbook(page, sheets) {
  const bytes = await page.evaluate((sheets) => {
    const entries = [
      { name: "xl/workbook.xml", content: `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
      ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: `<worksheet><sheetData>${sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>` })),
    ];
    return Array.from(createZipBytes(entries));
  }, sheets);
  return { name: "项目需求.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) };
}

async function uploadRequirements(page, target, file) {
  await page.locator(`.nav-item[data-view="${target === "aiInput" ? "ai-assistant" : "ai-plan"}"]`).click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(`[data-import-target="${target}"]`).click();
  await (await chooser).setFiles(file);
}

test("requirements read all sheets, multiline cells and zeros without replacing the questionnaire", async ({ page }) => {
  await page.evaluate(() => { document.querySelector("#workspaceQuestionnaire").value = "Q1. 原有问卷"; });
  const file = await workbook(page, [
    { name: "需求", rows: [["研究背景", "营养人群研究"], ["样本", 1200], ["备注", "第一行\n第二行"]] },
    { name: "补充", rows: [["预算下限", 0], ["最后一条", "全部保留"]] },
  ]);
  for (const target of ["aiInput", "aiPlanInput"]) {
    await uploadRequirements(page, target, file);
    await expect(page.locator(`#${target}ImportStatus`)).toContainText("已导入");
    const text = await page.locator(`#${target}`).inputValue();
    for (const value of ["营养人群研究", "1200", "第一行\n第二行", "预算下限\t0", "全部保留"]) expect(text).toContain(value);
    await expect(page.locator("#workspaceQuestionnaire")).toHaveValue("Q1. 原有问卷");
  }
});

test("empty, damaged and legacy files show local errors and preserve existing input", async ({ page }) => {
  await page.locator("#aiInput").fill("保留我的需求");
  for (const file of [
    { name: "空.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
    { name: "损坏.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") },
    { name: "旧版.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
  ]) {
    await uploadRequirements(page, "aiInput", file);
    await expect(page.locator("#aiInputImportStatus")).toContainText("导入失败");
    await expect(page.locator("#aiInput")).toHaveValue("保留我的需求");
  }
});

test("CSV briefs and structured questionnaires choose the correct conversion", async ({ page }) => {
  await uploadRequirements(page, "aiInput", { name: "需求.csv", mimeType: "text/csv", buffer: Buffer.from('研究背景,健康研究\n样本,1200') });
  await expect(page.locator("#aiInput")).toHaveValue(/研究背景,健康研究/);
  const structured = await workbook(page, [{ name: "问卷", rows: [["题号", "题干", "选项"], ["Q1", "喜欢哪种方案？", "A. 控糖;B. 控脂"]] }]);
  const text = await page.evaluate(async (bytes) => documentImportFileToText(new File([new Uint8Array(bytes)], "问卷.xlsx")), [...structured.buffer]);
  expect(text).toContain("Q1.");
  expect(text).toContain("喜欢哪种方案");
  expect(text).toContain("A. 控糖");
});

test("free-layout questionnaire works; a brief cannot be mistaken for a questionnaire template", async ({ page }) => {
  const questionnaire = await workbook(page, [{ name: "自由排版", rows: [["Q1. 您关注什么？"], ["A. 控糖"], ["B. 控脂"]] }]);
  await page.locator("#aiQuestionnaireTemplateFile").setInputFiles(questionnaire);
  await expect(page.locator("#aiQuestionnaireTemplatePreview")).toContainText("1 题");
  const brief = await workbook(page, [{ name: "需求", rows: [["研究背景", "营养健康"], ["研究方法", "定量问卷"]] }]);
  await page.locator("#aiQuestionnaireTemplateFile").setInputFiles(brief);
  await expect(page.locator("#aiQuestionnaireTemplatePreview")).toContainText("导入需求文档");
});

test("legacy binary data never becomes CSV text", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "旧版.xls");
    handleCrosstabImport(file);
    handleAiReportImport(file);
    try { await cleaningFileToParsed(file); return "unexpected success"; } catch (error) { return error.message; }
  });
  expect(result).toContain("另存为 .xlsx");
  await expect(page.locator("#crosstabResults")).toContainText("另存为 .xlsx");
  await expect(page.locator("#aiReportDataPreview")).toContainText("另存为 .xlsx");
});

test("Word, PowerPoint and Excel plan templates preserve document text", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const word = new File([createZipBytes([{ name: "word/document.xml", content: '<w:document><w:body><w:p><w:r><w:t>研究背景：营养健康</w:t></w:r></w:p></w:body></w:document>' }])], "需求.docx");
    const slides = new File([createZipBytes([{ name: "ppt/slides/slide1.xml", content: '<p:sld><a:p><a:r><a:t>研究目标：细分人群</a:t></a:r></a:p></p:sld>' }])], "需求.pptx");
    return [await documentImportFileToText(word, true), await documentImportFileToText(slides, true)];
  });
  expect(result[0]).toContain("研究背景：营养健康");
  expect(result[1]).toContain("研究目标：细分人群");
  const file = await workbook(page, [{ name: "方案", rows: [["一、研究背景"], ["营养健康产品的用户研究与产品机会探索"], ["二、研究目标"], ["细分人群需求，了解行为习惯及购买意愿"]] }]);
  await page.locator("#aiPlanTemplateFile").setInputFiles(file);
  await expect(page.locator("#aiPlanTemplatePreview")).toContainText("章节");
  await expect(page.locator("#aiPlanTemplatePreview")).toContainText("研究背景");
});

test("read failures preserve input and incomplete workbooks report errors", async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector("#aiInput").value = "已有需求";
    await handleQuestionnaireImport({ name: "需求.xlsx", arrayBuffer: async () => { throw new Error("文件读取失败"); } }, "aiInput");
    const broken = createZipBytes([{ name: "xl/workbook.xml", content: '<workbook xmlns:r="test"><sheets><sheet name="缺失" r:id="rId1"/></sheets></workbook>' }]);
    try { await xlsxToWorkbookSheets(broken.buffer); return "unexpected success"; } catch (error) { return error.message; }
  });
  await expect(page.locator("#aiInput")).toHaveValue("已有需求");
  await expect(page.locator("#aiInputImportStatus")).toContainText("文件读取失败");
  expect(result).toContain("工作表");
});

test("user regression workbook imports through both requirement buttons", async ({ page }) => {
  test.skip(!process.env.IMPORT_REGRESSION_FILE, "Set a local workbook path for private-file verification");
  for (const target of ["aiInput", "aiPlanInput"]) {
    await uploadRequirements(page, target, process.env.IMPORT_REGRESSION_FILE);
    await expect(page.locator(`#${target}ImportStatus`)).toContainText("已导入");
    await expect(page.locator(`#${target}`)).toHaveValue(/研究背景及目的/);
    await expect(page.locator(`#${target}`)).toHaveValue(/1200/);
    const bytes = require("node:fs").readFileSync(process.env.IMPORT_REGRESSION_FILE);
    const cells = await page.evaluate(async (bytes) => {
      const sheets = await xlsxToWorkbookSheets(new Uint8Array(bytes).buffer);
      return sheets.flatMap((sheet) => sheet.rows.flat()).filter(Boolean).map((cell) => normalizeImportedText(cell));
    }, [...bytes]);
    const imported = await page.locator(`#${target}`).inputValue();
    for (const cell of cells) expect(imported).toContain(cell);
  }
});
