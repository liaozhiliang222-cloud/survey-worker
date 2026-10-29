const { test, expect } = require("@playwright/test");

async function openSettings(page, saved) {
  await page.addInitScript((settings) => {
    localStorage.setItem("surveykit_tour_done", "1");
    if (settings) localStorage.setItem("surveyAiSettings", JSON.stringify(settings));
  }, saved);
  await page.goto("/#settings");
}

test("旧档位不会覆盖已保存的模型名称，保存后保留个人设置", async ({ page }) => {
  await openSettings(page, {
    provider: "openai", model: "account-model-id", modelTier: "gpt-4o",
    url: "https://api.openai.com/v1/chat/completions", apiKey: "synthetic-test-key",
  });
  await expect(page.locator("#aiModelTier")).toHaveCount(0);
  await expect(page.locator("#aiModelName")).toHaveValue("account-model-id");
  await expect(page.locator("#aiApiKey")).toHaveValue("synthetic-test-key");
  await page.locator("#saveAiSettings").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("surveyAiSettings")));
  expect(saved.model).toBe("account-model-id");
  expect(saved.apiKey).toBe("synthetic-test-key");
  expect(saved.modelTier).toBeUndefined();
});

test("切换个人供应商只预填接口，自定义接口保留输入", async ({ page }) => {
  await openSettings(page);
  await expect(page.locator("#aiModelName")).toHaveValue("deepseek-v4.1-flash");
  await page.locator("#aiProvider").selectOption("openai");
  await expect(page.locator("#aiModelName")).toBeEmpty();
  await expect(page.locator("#aiApiBaseUrl")).toHaveValue("https://api.openai.com/v1/chat/completions");
  await page.locator("#aiModelName").fill("account-model-id");
  await page.locator("#aiApiKey").fill("synthetic-test-key");
  await page.locator("#aiProvider").selectOption("custom");
  await expect(page.locator("#aiModelName")).toHaveValue("account-model-id");
  await page.locator("#saveAiSettings").click();
  await expect(page.locator("#aiSettingsPreview")).toContainText("设置校验通过");
});

test("OpenAI 连接测试使用当前输出参数并按手填模型发送", async ({ page }) => {
  let request;
  await page.route("**/api/ai", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({
      json: { choices: [{ message: { content: "连接成功" } }] },
      headers: { "X-Actual-Model": "account-model-id" },
    });
  });
  await openSettings(page, {
    provider: "openai", model: "account-model-id", modelTier: "gpt-4o",
    url: "https://api.openai.com/v1/chat/completions", apiKey: "synthetic-test-key",
  });
  await page.locator("#testAiSettings").click();
  await expect(page.locator("#aiSettingsPreview")).toContainText("连接成功");
  expect(request.body.model).toBe("account-model-id");
  expect(request.body.max_completion_tokens).toBe(1024);
  expect(request.body.max_tokens).toBeUndefined();
  expect(request.body.temperature).toBeUndefined();
});

test("无个人 Key 仍通过内置模型调用，保留兼容参数", async ({ page }) => {
  let request;
  await page.route("**/api/ai", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { choices: [{ message: { content: "连接成功" } }] } });
  });
  await openSettings(page);
  await page.locator("#testAiSettings").click();
  await expect(page.locator("#aiSettingsPreview")).toContainText("连接成功");
  expect(request.provider).toBe("opencode-go");
  expect(request.apiKey).toBe("");
  expect(request.body.max_tokens).toBe(20);
  expect(request.body.max_completion_tokens).toBeUndefined();
});
