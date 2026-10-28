const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
});

async function openView(page, viewId) {
  await page.goto("/");
  await page.locator(`[data-view="${viewId}"]`).evaluate((button) => button.click());
  await expect(page.locator(`#${viewId}`)).toHaveClass(/active/);
}

test("空项目总览只显示开始区，新建项目后展开档案表单", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".dashboard-workspace")).toHaveClass(/is-blank/);
  await expect(page.locator(".dashboard-empty-state")).toBeVisible();
  for (const selector of [".dashboard-flow-panel", ".dashboard-sidebar", ".dashboard-focus-panel", "#workspaceDeleteProject", "#workspaceExportProject"]) {
    await expect(page.locator(selector)).toBeHidden();
  }
  expect(await page.locator("#overview").evaluate((view) => view.scrollHeight)).toBeLessThanOrEqual(900);
  await page.locator("#workspaceNewProject").click();
  await expect(page.locator(".project-panel")).toBeVisible();
  await expect(page.locator("#workspaceProjectName")).toBeFocused();
  await expect(page.locator(".dashboard-flow-panel")).toBeVisible();
});

test("交叉表上传区支持拖入文件并显示导入结果", async ({ page }) => {
  await openView(page, "crosstab-analysis");
  await expect(page.locator("#crosstabDropzone")).toBeVisible();
  await expect(page.locator("#importCrosstabData")).toBeHidden();
  await page.locator("#crosstabDropzone").evaluate((zone) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["性别,是否购买\n男,是\n女,否"], "拖入数据.csv", { type: "text/csv" }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#crosstabDropzoneFile")).toContainText("已导入《拖入数据.csv》· 2 行 × 2 列");
  await expect(page.locator("#crosstabDropzone")).toHaveClass(/has-file/);
  await expect(page.locator("#crosstabData")).toHaveValue(/性别,是否购买/);
});

test("数据清洗步骤条跟随实际进度", async ({ page }) => {
  await openView(page, "cleaning-rules");
  const steps = page.locator("#cleaning-rules .task-flow li");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "active");
  await page.locator("#loadCleaningExample").click();
  await expect(steps.nth(0)).toHaveAttribute("data-state", "completed");
  await expect(steps.nth(1)).toHaveAttribute("data-state", "completed");
  await expect(steps.nth(3)).toHaveAttribute("data-state", "ready");
  await page.locator("#executeCleaning").click();
  await expect(steps.nth(3)).toHaveAttribute("data-state", "completed");
  await expect(steps.nth(3).locator("small")).toContainText("保留");
});

test("长页面主按钮滚出视口时底部浮出，点击触发原按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openView(page, "crosstab-analysis");
  await page.locator("#loadCrosstabExample").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const bar = page.locator("#crosstab-analysis .page-action-bar");
  await expect(bar).toBeVisible();
  await expect(bar.locator("button")).toHaveText("生成并下载全部题目表");
  const download = page.waitForEvent("download");
  await bar.locator("button").click();
  await download;
  await expect(page.locator("#toastContainer")).toContainText("已生成");
  await page.locator("#runQuestionPivot").scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
});

test("帮助说明在右侧抽屉打开，不离开当前工具页", async ({ page }) => {
  await openView(page, "crosstab-analysis");
  const help = page.locator("#crosstab-analysis .model-help-btn");
  await help.click();
  const drawer = page.locator("#helpDrawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("#helpDrawerTitle")).toHaveText("交叉表分析帮助");
  await expect(drawer.locator(".guide-card").first()).toBeVisible();
  await expect(drawer.locator("[data-jump]")).toHaveCount(0);
  await expect(page.locator("#crosstab-analysis")).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(help).toBeFocused();
  await page.goto("/#crosstab-guide");
  await expect(page.locator("#crosstab-guide")).toHaveClass(/active/);
});
