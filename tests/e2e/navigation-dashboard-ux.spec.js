const { test, expect } = require("@playwright/test");

async function openCleanApp(page, hash = "") {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("surveykit_tour_done", "1");
  });
  await page.goto(`/${hash}`);
}

test("侧边导航按阶段折叠，并自动展开当前模块", async ({ page }) => {
  await openCleanApp(page);

  const beforeToggle = page.locator('[data-nav-phase="before"] > .nav-group-toggle');
  const duringToggle = page.locator('[data-nav-phase="during"] > .nav-group-toggle');
  await expect(beforeToggle).toHaveAttribute("aria-expanded", "true");
  await expect(duringToggle).toHaveAttribute("aria-expanded", "false");

  await page.locator('[data-view="crosstab-analysis"]').evaluate((button) => button.click());
  await expect(page.locator("#crosstab-analysis")).toHaveClass(/active/);
  await expect(duringToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#crosstab-analysis > .module-context-bar")).toContainText("调研中");
  await expect(page.locator("#crosstab-analysis > .module-context-bar")).toContainText("交叉表分析");
  await expect(page).toHaveURL(/#crosstab-analysis$/);

  await page.locator("#crosstab-analysis .module-context-back").click();
  await expect(page.locator("#overview")).toHaveClass(/active/);
  await expect(page).not.toHaveURL(/#crosstab-analysis$/);
});

test("工作台首屏突出下一步，并按需展开项目档案", async ({ page }) => {
  await openCleanApp(page);

  await expect(page.locator("#dashboardFocusTitle")).toHaveText("项目档案");
  await expect(page.locator("#dashboardFocusCount")).toContainText("0 / 18");
  await expect(page.locator(".project-panel")).not.toHaveClass(/form-expanded/);
  await expect(page.locator("#toggleProjectForm")).toHaveAttribute("aria-expanded", "false");

  await page.locator("#dashboardContinueAction").click();
  await expect(page.locator(".project-panel")).toHaveClass(/form-expanded/);
  await expect(page.locator("#toggleProjectForm")).toHaveAttribute("aria-expanded", "true");

  const stageBlocks = page.locator(".dashboard-stage-block");
  await expect(stageBlocks).toHaveCount(4);
  await expect(stageBlocks.filter({ hasText: "调研前" })).not.toHaveClass(/collapsed/);
  await expect(stageBlocks.filter({ hasText: "数据清洗" })).toHaveClass(/collapsed/);
  await stageBlocks.filter({ hasText: "数据清洗" }).locator(".dashboard-stage-toggle").click();
  await expect(stageBlocks.filter({ hasText: "数据清洗" })).not.toHaveClass(/collapsed/);
});

test("移动端菜单同步当前模块，并支持 Escape 关闭", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCleanApp(page, "#pptx-report");

  await expect(page.locator("#pptx-report")).toHaveClass(/active/);
  await expect(page.locator(".mobile-topbar strong")).toHaveText("PPT 报告生成");
  await page.locator("#mobileMenuBtn").click();
  await expect(page.locator("#mobileMenuBtn")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#appSidebar")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobileMenuBtn")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#appSidebar")).not.toHaveClass(/open/);
});
