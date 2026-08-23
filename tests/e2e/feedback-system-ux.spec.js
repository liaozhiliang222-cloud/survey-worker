const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.goto("/");
});

test("业务空态会自动补充状态语义", async ({ page }) => {
  await page.locator('[data-view="ai-plan"]').evaluate((button) => button.click());
  await page.locator("#generateAiPlan").click();

  const state = page.locator("#aiPlanResults .empty-state");
  await expect(state).toHaveAttribute("data-feedback-state", "warning");
  await expect(state).toHaveAttribute("role", "alert");
  await expect(state).toContainText("请先填写必填项");

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "feedbackTestHost";
    host.innerHTML = '<div class="empty-state"><strong>正在解析数据</strong><span>请稍候</span></div>';
    document.body.appendChild(host);
  });
  const loading = page.locator("#feedbackTestHost .empty-state");
  await expect(loading).toHaveAttribute("data-feedback-state", "loading");
  await expect(loading).toHaveAttribute("aria-busy", "true");
});

test("Toast 转义内容、合并重复消息并允许关闭", async ({ page }) => {
  await page.evaluate(() => {
    showToast("<b>网络异常</b>", "error", 10_000);
    showToast("<b>网络异常</b>", "error", 10_000);
  });

  const toast = page.locator("#toastContainer .toast");
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("role", "alert");
  await expect(toast.locator(".toast-message")).toHaveText("<b>网络异常</b>");
  await expect(toast.locator("b")).toHaveCount(0);
  await toast.locator(".toast-close").click();
  await expect(toast).toHaveCount(0);
});

test("按钮加载态结束后恢复原内容和禁用状态", async ({ page }) => {
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "feedbackLoadingButton";
    button.className = "primary-btn";
    button.innerHTML = "<span>生成报告</span>";
    document.body.appendChild(button);
    setButtonLoading(button, true, "正在生成报告");
  });

  const button = page.locator("#feedbackLoadingButton");
  await expect(button).toBeDisabled();
  await expect(button).toHaveClass(/btn-loading/);
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveText("正在生成报告");

  await page.evaluate(() => setButtonLoading(document.querySelector("#feedbackLoadingButton"), false));
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveClass(/btn-loading/);
  await expect(button.locator("span")).toHaveText("生成报告");
  await expect(button).not.toHaveAttribute("aria-busy", "true");
});
