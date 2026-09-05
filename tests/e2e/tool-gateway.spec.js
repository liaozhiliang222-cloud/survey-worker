const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
});

test("三个专业工具通过确定性 Gateway 更新页面结果", async ({ page }) => {
  await page.goto("/");

  await page.locator('[data-view="sample"]').click();
  await page.locator("#margin").fill("4");
  await expect(page.locator("#baseSample")).toHaveText("601");
  await expect(page.locator("#grossSample")).toHaveText("752");

  await page.locator('[data-view="quota"]').click();
  await page.locator("#quotaTotal").fill("401");
  await expect(page.locator("#quotaSummary")).toContainText("目标样本量 401");
  await expect(page.locator("#quotaTable tbody tr")).toHaveCount(2);
  const counts = await page.locator("#quotaTable tbody tr td:last-child").allTextContents();
  expect(counts.map(Number).reduce((sum, value) => sum + value, 0)).toBe(401);

  await page.locator('[data-view="link-test"]').click();
  await page.locator("#questionnaireText").fill("Q1. 您是否购买？\nA. 是 → 跳至 Q3\nB. 否");
  await page.locator("#runAudit").click();
  await expect(page.locator("#auditResults")).toContainText("跳题目标不存在：Q3");
  await expect(page.locator("#blockerCount")).toHaveText("1");
});

test("从 Research Project 打开工具后可保存结构化结果到当前项目", async ({ page }) => {
  const project = { id: "project-tools", title: "荣耀年轻用户 NPS 研究", client_name: "荣耀", brief: "", research_goal: "", status: "active", updated_at: "2026-08-30T00:00:00.000Z" };
  let savedPayload = null;
  await page.route("**/api/research/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace("/api/research", "");
    const fulfill = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/projects") return fulfill({ projects: [project] });
    if (pathname === "/projects/project-tools") return fulfill({ project });
    if (pathname.endsWith("/messages")) return fulfill({ messages: [] });
    if (pathname.endsWith("/artifacts")) return fulfill({ artifacts: [] });
    if (pathname.endsWith("/files")) return fulfill({ files: [] });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: pathname } }) });
  });
  await page.route("**/api/tools/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/tools/results" && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, tool: "tool-results", data: { project_id: "project-tools", results: [] }, meta: {} }) });
    }
    if (url.pathname === "/api/tools/quota/results" && request.method() === "POST") {
      savedPayload = request.postDataJSON();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, tool: "quota", data: { tool_result: { id: "result-1", project_id: "project-tools", tool_id: "quota", input: savedPayload.input, result: { total_sample: 400 }, created_at: new Date().toISOString() } }, meta: { deterministic: true, uses_ai: false } }) });
    }
    return route.fallback();
  });

  await page.goto("/");
  await page.locator('[data-view="research"]').click();
  await page.locator(".research-project-card").click();
  await page.locator('[data-research-tool="quota"]').click();
  await expect(page.locator("#quota")).toHaveClass(/active/);
  await expect(page.locator("#quota [data-tool-project-context]")).toContainText("荣耀年轻用户 NPS 研究");
  await expect(page.locator('[data-save-tool-result="quota"]')).toBeVisible();
  await expect(page.locator('[data-save-tool-result="quota"]')).toBeEnabled();
  await page.locator('[data-save-tool-result="quota"]').click();
  await expect(page.locator('[data-save-tool-result="quota"]')).toHaveText("已保存到项目");
  expect(savedPayload.project_id).toBe("project-tools");
  expect(savedPayload.input.mode).toBe("single");
  expect(savedPayload.input.total_sample).toBe(400);
});
