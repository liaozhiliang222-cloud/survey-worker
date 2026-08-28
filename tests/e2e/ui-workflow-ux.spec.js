const { test, expect } = require("@playwright/test");

async function openView(page, viewId) {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.goto("/");
  await page.locator(`[data-view="${viewId}"]`).evaluate((button) => button.click());
  await expect(page.locator(`#${viewId}`)).toHaveClass(/active/);
}

test("移动端页头不遮挡页面标题，AI 报告按输入到结果排序", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, "ai-report");

  const topbar = await page.locator(".mobile-topbar").boundingBox();
  const title = await page.locator("#ai-report .page-title").boundingBox();
  const config = await page.locator("#ai-report .ai-report-config").boundingBox();
  const output = await page.locator("#aiReportOutputPanel").boundingBox();
  expect(topbar).toBeTruthy();
  expect(title).toBeTruthy();
  expect(config).toBeTruthy();
  expect(output).toBeTruthy();
  expect(topbar.y + topbar.height).toBeLessThanOrEqual(title.y);
  expect(config.y).toBeLessThan(output.y);
  await expect(page.locator("#aiReportOutputPanel")).toHaveClass(/is-dormant/);
  await expect(page.locator('[data-flow-step="generate"]')).toHaveAttribute("data-state", "locked");

  const importButton = await page.locator("#importAiReportData").boundingBox();
  const menuButton = await page.locator("#mobileMenuBtn").boundingBox();
  expect(importButton.height).toBeGreaterThanOrEqual(44);
  expect(menuButton.height).toBeGreaterThanOrEqual(44);
});

test("交叉表区分识别、批量生成和当前变量分析", async ({ page }) => {
  await openView(page, "crosstab-analysis");
  await expect(page.locator("#crosstabConfigureStage")).toHaveAttribute("data-state", "locked");
  await expect(page.locator("#runQuestionPivot")).toHaveText("生成全部题目表");
  await expect(page.locator("#runCrosstab")).toHaveText("生成当前两变量表");
  await expect(page.locator("#runQuestionPivot")).toHaveClass(/primary-btn/);
  await expect(page.locator("#runCrosstab")).toHaveClass(/secondary-btn/);

  await page.locator("#loadCrosstabExample").click();
  await expect(page.locator("#crosstabConfigureStage")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#crosstabImportInspection")).toBeVisible();
  await expect(page.locator("#crosstabImportInspection")).toContainText("道题/字段");
  await expect(page.locator('#crosstab-analysis [data-flow-indicator="import"]')).toHaveAttribute("data-state", "completed");
});

test("PPT 报告未来步骤初始收起", async ({ page }) => {
  await openView(page, "pptx-report");
  await expect(page.locator("#pptxUploadStep")).toHaveAttribute("data-flow-state", "active");
  await expect(page.locator("#pptxConfigStep")).toHaveAttribute("data-flow-state", "locked");
  await expect(page.locator("#pptxDownloadStep")).toHaveAttribute("data-flow-state", "locked");
  await expect(page.locator("#pptxConfigStep .flow-step-locked-note")).toBeVisible();
  await expect(page.locator("#pptxReportTitle")).toBeHidden();
  await expect(page.locator("#pptxResult")).toBeHidden();
});

test("PPT 报告第三步在桌面端固定于右侧", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openView(page, "pptx-report");

  const main = await page.locator("#pptx-report .pptx-report-main").boundingBox();
  const download = await page.locator("#pptxDownloadStep").boundingBox();
  expect(main).toBeTruthy();
  expect(download).toBeTruthy();
  expect(download.x).toBeGreaterThan(main.x + main.width);
  expect(Math.abs(download.y - main.y)).toBeLessThan(4);
  await expect(page.locator("#pptxDownloadStep")).toHaveCSS("position", "sticky");

  await page.locator("#pptxConfigStep").evaluate((panel) => { panel.dataset.flowState = "active"; });
  await page.locator("#pptxDownloadStep").evaluate((panel) => { panel.dataset.flowState = "active"; });
  await page.locator(".content").evaluate((content) => { content.scrollTop = 500; });
  await page.waitForTimeout(100);
  const stickyDownload = await page.locator("#pptxDownloadStep").boundingBox();
  expect(stickyDownload.y).toBeGreaterThanOrEqual(54);
  expect(stickyDownload.y).toBeLessThanOrEqual(62);
});

test("AI 方案生成前不展示修改和导出操作", async ({ page }) => {
  await openView(page, "ai-plan");
  await expect(page.locator("#ai-plan")).not.toHaveClass(/workflow-has-result/);
  await expect(page.locator("#copyAiPlan")).toBeHidden();
  await expect(page.locator("#exportAiPlanWord")).toBeHidden();
  await expect(page.locator("#ai-plan .ai-revise-panel")).toBeHidden();
  await expect(page.locator("#aiPlanResults .flow-pending-summary")).toBeVisible();
});
