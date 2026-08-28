const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function mockResearchApi(page) {
  const project = {
    id: "project-1",
    title: "荣耀年轻用户 NPS 研究",
    client_name: "荣耀",
    brief: "了解年轻用户体验",
    research_goal: "定位 NPS 改进机会",
    status: "active",
    updated_at: "2026-08-27T08:00:00.000Z",
  };
  const messages = [];
  const artifacts = [];
  const files = [];
  let lastMessagePayload = null;
  await page.route("**/api/research/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/research", "");
    const method = request.method();
    let payload = {};
    if (request.postData() && (request.headers()["content-type"] || "").includes("application/json")) payload = JSON.parse(request.postData());
    const fulfill = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/projects" && method === "GET") return fulfill({ projects: [] });
    if (path === "/projects" && method === "POST") return fulfill({ project: { ...project, ...payload } }, 201);
    if (path === "/projects/project-1" && method === "GET") return fulfill({ project });
    if (path === "/projects/project-1" && method === "PATCH") return fulfill({ project: Object.assign(project, payload) });
    if (path === "/projects/project-1/messages" && method === "GET") return fulfill({ messages });
    if (path === "/projects/project-1/messages" && method === "POST") {
      lastMessagePayload = payload;
      const user = { id: "user-message-1", role: "user", content: payload.message };
      const assistant = { id: "assistant-message-1", role: "assistant", content: "# NPS 调研方案\n采用定量问卷与深访组合。" };
      messages.splice(0, messages.length, user, assistant);
      return fulfill({ message: assistant, user_message: user, reply: assistant.content, applied_context: { selected_files: payload.selected_file_ids || [], retrieved_chunks: payload.auto_retrieve === false ? [] : [{ file_id: "file-memory", chunk_index: 0 }] } });
    }
    if (path === "/projects/project-1/artifacts" && method === "GET") return fulfill({ artifacts });
    if (path === "/projects/project-1/artifacts" && method === "POST") {
      const artifact = { id: `artifact-${artifacts.length + 1}`, project_id: project.id, version: artifacts.length + 1, ...payload };
      artifacts.push(artifact);
      return fulfill({ artifact }, 201);
    }
    if (path === "/projects/project-1/artifacts/artifact-1" && method === "PATCH") {
      Object.assign(artifacts[0], payload);
      return fulfill({ artifact: artifacts[0] });
    }
    if (path === "/projects/project-1/artifacts/artifact-1" && method === "DELETE") return fulfill({}, 204);
    if (path === "/projects/project-1/files" && method === "GET") return fulfill({ files });
    if (path === "/projects/project-1/memory/search" && method === "GET") return fulfill({ query: url.searchParams.get("q"), matches: [{ file_id: "file-memory", file_name: "历史访谈.md", heading: "售后体验", chunk_index: 0, score: 26, content: "用户希望提升维修透明度。" }] });
    if (path === "/projects/project-1/files" && method === "POST") {
      const file = { id: `file-${files.length + 1}`, project_id: project.id, file_name: decodeURIComponent(request.headers()["x-research-file-name"]), file_type: "txt", mime_type: "text/plain", file_size: request.postDataBuffer()?.length || 1, category: "brief", parse_status: "completed", summary: "年轻用户项目 Brief", parse_note: "", created_at: "2026-08-27T08:00:00.000Z" };
      files.push(file); return fulfill({ file }, 201);
    }
    if (/^\/projects\/project-1\/files\/file-\d+$/.test(path) && method === "GET") { const file = files.find((item) => path.endsWith(item.id)); return fulfill({ file: { ...file, preview: "年轻用户项目 Brief 正文" } }); }
    if (/^\/projects\/project-1\/files\/file-\d+$/.test(path) && method === "PATCH") { const file = files.find((item) => path.endsWith(item.id)); Object.assign(file, payload); return fulfill({ file }); }
    if (/^\/projects\/project-1\/files\/file-\d+$/.test(path) && method === "DELETE") { const index = files.findIndex((item) => path.endsWith(item.id)); files.splice(index, 1); return fulfill({}, 204); }
    if (/\/files\/file-\d+\/reparse$/.test(path) && method === "POST") return fulfill({ file: files.find((item) => path.includes(item.id)) }, 202);
    return fulfill({ error: { message: `${method} ${path}` } }, 404);
  });
  return { getLastMessagePayload: () => lastMessagePayload };
}

test("AI 研究员完成项目、对话、成果和继续修改闭环", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  const mock = await mockResearchApi(page);
  await page.goto("/");
  await page.locator('[data-view="research"]').click();
  await expect(page.locator("#research")).toHaveClass(/active/);
  await page.locator("#researchNewProject").click();
  await page.locator("#researchCreateTitle").fill("荣耀年轻用户 NPS 研究");
  await page.locator("#researchCreateClient").fill("荣耀");
  await page.locator("#researchCreateBrief").fill("了解年轻用户体验");
  await page.locator("#researchCreateGoal").fill("定位 NPS 改进机会");
  await page.locator("#researchCreateSubmit").click();
  await expect(page.locator("#researchWorkspaceTitle")).toContainText("荣耀年轻用户");

  await page.locator("#researchFileInput").setInputFiles({ name: "客户Brief.txt", mimeType: "text/plain", buffer: Buffer.from("年轻用户项目 Brief 正文") });
  await expect(page.locator(".research-file-item")).toContainText("客户Brief.txt");
  await page.locator("#researchAddContext").click();
  await expect(page.locator("#researchAutoRetrieve")).toBeChecked();
  await page.locator("#researchMemoryQuery").fill("售后体验");
  await page.locator("#researchMemorySearch").click();
  await expect(page.locator("#researchMemoryResults")).toContainText("历史访谈.md");
  await page.locator('#researchContextFileOptions input[type="checkbox"]').check();
  await page.locator("#researchContextApply").click();
  await expect(page.locator("#researchContextChips")).toContainText("客户Brief.txt");

  await page.locator('[data-research-prompt*="完整的调研方案"]').click();
  await expect(page.locator("#researchChatInput")).toHaveValue(/完整的调研方案/);
  await page.locator("#researchSendMessage").click();
  expect(mock.getLastMessagePayload().selected_file_ids).toEqual(["file-1"]);
  expect(mock.getLastMessagePayload().auto_retrieve).toBe(true);
  expect(mock.getLastMessagePayload().task_type).toBe("research_plan");
  await expect(page.locator("#researchConnectionState")).toContainText("检索 1 个片段");
  await expect(page.locator(".research-message.assistant")).toContainText("NPS 调研方案");
  await page.locator(".research-message.assistant .secondary-btn").click();
  await page.locator("#researchArtifactCancel").click();
  await expect(page.locator("#researchSaveArtifactDialog")).not.toBeVisible();
  await expect(page.locator(".research-artifact-card")).toHaveCount(0);
  await page.locator(".research-message.assistant .secondary-btn").click();
  await page.locator("#researchArtifactType").selectOption("research_plan");
  await page.locator("#researchArtifactSave").click();
  await expect(page.locator(".research-artifact-card")).toContainText("V1");
  await expect(page.locator(".research-artifact-card")).toContainText("基于此版本派生");
  await page.locator(".research-artifact-card .secondary-btn").click();
  await expect(page.locator("#researchContextChips")).toContainText("NPS 调研方案");
  await expect(page.locator("#researchChatInput")).toHaveValue(/继续修改/);
});

test("AI 研究员移动端使用 Tab 且不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await mockResearchApi(page);
  await page.goto("/");
  await page.locator('[data-view="research"]').evaluate((button) => button.click());
  await page.locator("#researchNewProject").click();
  await page.locator("#researchCreateTitle").fill("移动端研究");
  await page.locator("#researchCreateSubmit").click();
  await expect(page.locator(".research-mobile-tabs")).toBeVisible();
  await page.locator('[data-research-tab="artifacts"]').click();
  await expect(page.locator('[data-research-panel="artifacts"]')).toHaveClass(/active/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("AI 研究员从本地文件打开时可进入新建项目", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_FILE_PROTOCOL !== "1", "仅在显式开启 file 协议检查时运行");
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  const fileUrl = pathToFileURL(path.resolve(__dirname, "../../index.html")).href;
  await page.goto(`${fileUrl}#research`);
  await expect(page.locator("#research")).toHaveClass(/active/);
  await page.locator("#researchNewProject").click();
  await expect(page.locator("#researchCreate")).toBeVisible();
  await expect(page.locator("#researchCreateTitle")).toBeEditable();
});
