const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
});

test("键盘焦点框为 2px 不透明品牌蓝，输入框聚焦同色描边", async ({ page }) => {
  await page.goto("/#crosstab-analysis");
  await page.locator("#loadCrosstabExample").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`;
  });
  expect(outline).toBe("2px solid rgb(37, 99, 235)");
  await page.locator("#navSearch").focus();
  await expect(page.locator("#navSearch")).toHaveCSS("border-top-color", "rgb(37, 99, 235)");
});

test("界面文字不小于 12px（幻灯片缩略图除外）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const view of ["overview", "crosstab-analysis", "cleaning-rules", "pptx-report", "ai-plan", "research", "kano"]) {
    await page.goto(`/#${view}`);
    await expect(page.locator(`#${view}`)).toHaveClass(/active/);
    const tiny = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((el) => el.offsetParent && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .filter((el) => !el.closest(".proposal-canvas, .proposal-example, .pptx-page-mini"))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
      .map((el) => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 20)}`));
    expect(tiny, view).toEqual([]);
  }
});

test("曾经未定义的变量现在有值", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(() => ["--primary", "--border", "--text", "--text-muted"]
    .map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()));
  for (const value of values) expect(value).not.toBe("");
});
