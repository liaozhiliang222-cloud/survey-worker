// 可用性测试固定任务的最短路径（阶段 5）。只用用户可见的点击和文件选择，记录操作次数。
// 改版后路径变长或某一步不可见，这里会先失败；真人测试见 docs/USABILITY_TEST_KIT_2026-10-28.md。
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const questionnaire = [
  "Q1. 您的性别是？",
  "1. 男",
  "2. 女",
  "Q2. 您过去 3 个月是否购买过宠物饮水机？",
  "1. 是",
  "2. 否",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.setViewportSize({ width: 1440, height: 900 });
});

function counter(page) {
  let actions = 0;
  return {
    click: async (locator) => { actions += 1; await expect(locator).toBeVisible(); await locator.click(); },
    fill: async (locator, value) => { actions += 1; await expect(locator).toBeVisible(); await locator.fill(value); },
    press: async (locator, key) => { actions += 1; await locator.press(key); },
    choose: async (trigger, files) => {
      actions += 1;
      const chooser = page.waitForEvent("filechooser");
      await expect(trigger).toBeVisible();
      await trigger.click();
      await (await chooser).setFiles(files);
    },
    get count() { return actions; },
  };
}

test("任务 1：空项目 → 导入问卷并保存到项目，≤ 3 步", async ({ page }) => {
  await page.goto("/");
  const user = counter(page);
  await user.choose(page.locator(".dashboard-empty-card", { hasText: "导入问卷" }), {
    name: "宠物饮水机问卷.txt", mimeType: "text/plain", buffer: Buffer.from(questionnaire),
  });
  await expect(page.locator("#questionnaireImportPreview")).toBeVisible();
  await expect(page.locator("#questionnaireImportPreview")).toContainText("宠物饮水机问卷.txt");
  await expect(page.locator("#questionnaireImportPreview")).toContainText("识别题量：2；选项：4 个");
  await user.click(page.locator("#applyQuestionnaireImport"));
  await expect(page.locator("#workspaceQuestionnaire")).toHaveValue(/宠物饮水机/);
  expect(user.count).toBeLessThanOrEqual(3);
});

test("任务 2：空项目 → 导入数据得到交叉表 Excel，≤ 5 步", async ({ page }) => {
  await page.goto("/");
  const user = counter(page);
  // 交叉表在默认收起的“调研中”分组里，用工具库搜索找到它。
  await user.fill(page.locator("#navSearch"), "交叉表");
  await user.press(page.locator("#navSearch"), "Enter");
  await expect(page.locator("#crosstab-analysis")).toHaveClass(/active/);
  await user.choose(page.locator("#crosstabDropzone"), path.resolve(__dirname, "../fixtures/imports/raw-survey.xlsx"));
  await expect(page.locator("#crosstabDropzoneFile")).toContainText("已导入");
  const download = page.waitForEvent("download");
  await user.click(page.locator("#runQuestionPivot"));
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/i);
  await expect(page.locator("#toastContainer")).toContainText("已生成");
  expect(user.count).toBeLessThanOrEqual(5);
});

test("任务 3 的报告服务连不上时，提示原因而不是“解析失败：解析失败”", async ({ page }) => {
  await page.route("**/pptx-api/parse", (route) => route.fulfill({ status: 502, body: "" }));
  await page.goto("/#pptx-report");
  await page.locator("#pptxFileInput").setInputFiles(path.resolve(__dirname, "../fixtures/imports/standard-crosstab.xlsx"));
  await expect(page.locator("#pptxParseBtn")).toBeEnabled();
  await page.locator("#pptxParseBtn").click();
  await expect(page.locator("#pptxParseStatus")).toHaveText("解析失败：报告服务暂时连不上（502），请稍后重试，已选的文件无需重新上传");
  await expect(page.locator("#pptxParseBtn")).toBeEnabled();
});

// 任务 3（生成 PPT 报告）依赖报告服务，完整路径由 tests/e2e/pptx-report-flow.spec.js 覆盖：
// 上传交叉表 → 解析维度 → 预览 → 生成并下载，共 4 步。
