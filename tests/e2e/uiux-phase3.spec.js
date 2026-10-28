const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
});

test("侧栏一级为项目 / AI 研究员 / 工具库 / 设置，工具库可搜索", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".nav-utility:not(.nav-footer) .nav-item strong")).toHaveText(["项目", "AI 研究员"]);
  await expect(page.locator(".nav-footer .nav-item strong")).toHaveText(["设置", "常见问题"]);
  await expect(page.locator('[data-nav-phase="help"]')).toHaveCount(0);

  const search = page.locator("#navSearch");
  await search.fill("kano");
  await expect(page.locator('.nav-group .nav-item:visible')).toHaveText(["研究模型"]);
  await search.fill("没有这个工具");
  await expect(page.locator(".nav-search-empty")).toBeVisible();
  await search.fill("清洗");
  await search.press("Enter");
  await expect(page.locator("#cleaning-rules")).toHaveClass(/active/);
  await expect(search).toHaveValue("");
});

test("模型子页面高亮“研究模型”入口", async ({ page }) => {
  await page.goto("/#kano");
  await expect(page.locator("#kano")).toHaveClass(/active/);
  await expect(page.locator('.nav-item[data-view="research-models"]')).toHaveClass(/active/);
  await expect(page).toHaveTitle("KANO 分析 · SurveyKit 调研工具箱");
});

test("当前项目显示在侧栏和工具页，点击回到项目页", async ({ page }) => {
  await page.goto("/");
  await page.locator("#workspaceNewProject").click();
  await page.locator("#workspaceProjectName").fill("宠物饮水机调研");
  await expect(page.locator("#navProjectName")).toHaveText("当前：宠物饮水机调研");
  await page.goto("/#crosstab-analysis");
  await page.locator('.nav-item[data-view="overview"]').click();
  await page.locator("#workspaceProjectName").fill("宠物饮水机调研");
  await page.locator('.nav-item[data-view="crosstab-analysis"]').evaluate((item) => item.click());
  const link = page.locator("#crosstab-analysis .module-context-project");
  await expect(link).toHaveText("当前项目：宠物饮水机调研");
  await link.click();
  await expect(page.locator("#overview")).toHaveClass(/active/);
});

test("AI 方案 / 问卷设计说明与 AI 研究员的分工", async ({ page }) => {
  await page.goto("/#ai-plan");
  const note = page.locator("#ai-plan .page-title-note");
  await expect(note).toContainText("免登录");
  await note.locator('a[href="#research"]').click();
  await expect(page.locator("#research")).toHaveClass(/active/);
});

test("手机抽屉：关闭按钮、只展开当前分组、一屏可见设置", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#crosstab-analysis");
  await page.locator("#mobileMenuBtn").click();
  const sidebar = page.locator("#appSidebar");
  await expect(sidebar).toHaveClass(/open/);
  await expect(page.locator('[data-nav-phase="during"]')).not.toHaveClass(/collapsed/);
  await expect(page.locator('[data-nav-phase="before"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-nav-phase="after"]')).toHaveClass(/collapsed/);
  const settings = await page.locator('.nav-item[data-view="settings"]').boundingBox();
  expect(settings.y + settings.height).toBeLessThanOrEqual(812);
  expect((await sidebar.boundingBox()).width).toBeLessThanOrEqual(320);
  await page.locator("#sidebarClose").click();
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(page.locator("#mobileMenuBtn")).toBeFocused();
});
