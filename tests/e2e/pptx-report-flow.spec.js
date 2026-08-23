const path = require("node:path");
const fs = require("node:fs/promises");
const { test, expect } = require("@playwright/test");

const fixturePath = path.resolve(__dirname, "../fixtures/imports/standard-crosstab.xlsx");

const parseResponse = {
  segments: ["Total", "高意向", "低意向"],
  questions: 2,
  dimension_groups: [
    { name: "购买意向", segments: ["Total", "高意向", "低意向"] },
  ],
  research_modules: [
    { key: "概念测试", label: "概念测试结果" },
    { key: "用户需求", label: "用户需求" },
    { key: "优化建议", label: "优化建议" },
  ],
  recommended_core_module: "概念测试",
};

const previewResponse = {
  title: "Sprint 3 回归报告",
  pages: [
    {
      page_idx: 1,
      chapter: "概念测试",
      title: "概念吸引力形成转化基础",
      questions: [{ code: "Q1", title: "购买意愿" }],
      segments: ["Total", "高意向"],
      chart_type: "bar",
    },
    {
      page_idx: 2,
      chapter: "用户需求",
      title: "核心需求决定产品匹配度",
      questions: [{ code: "Q2", title: "功能偏好" }],
      segments: ["Total", "高意向"],
      chart_type: "bar",
    },
    {
      page_idx: 3,
      chapter: "优化建议",
      title: "优先解决使用障碍",
      questions: [{ code: "Q2", title: "功能偏好" }],
      segments: ["Total", "高意向"],
      chart_type: "bar",
    },
  ],
  question_catalog: [
    { code: "Q1", title: "购买意愿" },
    { code: "Q2", title: "功能偏好" },
  ],
  total_pages: 3,
  renderable_questions: 2,
  available_dimensions: [
    { key: "总体", label: "总体", segments: ["Total"] },
    { key: "购买意向", label: "购买意向", segments: ["高意向", "低意向"] },
  ],
  research_modules: parseResponse.research_modules,
  recommended_core_module: "概念测试",
};

const insightResponse = {
  report_id: "e2e-report",
  data_facts: [],
  global_findings: [],
  pages: previewResponse.pages.map((page, index) => ({
    page_idx: page.page_idx,
    slide_id: `page:${page.page_idx}`,
    chapter: page.chapter,
    title: page.title,
    questions: [{
      code: page.questions[0].code,
      title: page.questions[0].title,
      base: { Total: 120 },
      rows: [{
        option: index === 2 ? "存在障碍" : "认可",
        values: { Total: 60 + index * 4, 高意向: 76 + index * 3 },
      }],
    }],
  })),
};

function json(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockCommonPptxApis(page) {
  await page.route("**/pptx-api/parse", (route) => json(route, parseResponse));
  await page.route("**/pptx-api/preview?**", (route) => json(route, previewResponse));
  await page.route("**/pptx-api/insight-context", (route) => json(route, insightResponse));
  await page.route("**/pptx-api/report/**", (route) => json(route, { ok: true }));
}

async function openPptxReport(page) {
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.goto("/");
  const reportEntry = page.locator('[data-view="pptx-report"]');
  if (!(await reportEntry.isVisible())) {
    await page.locator('[data-nav-phase="after"] > .nav-group-toggle').click();
  }
  await reportEntry.click();
  await expect(page.locator("#pptx-report")).toHaveClass(/active/);
}

async function uploadAndParse(page) {
  await page.locator("#pptxFileInput").setInputFiles(fixturePath);
  const inspection = page.locator("#pptxImportInspection");
  await expect(inspection).toContainText("标准交叉表");
  await expect(inspection).toContainText("2 道题/字段");
  await page.locator("#pptxParseBtn").click();
  await expect(page.locator("#pptxParseStatus")).toContainText("已识别 3 个人群列、2 道题目");
  await expect(page.locator("#pptxPreviewBtn")).toBeEnabled();
}

test("上传、统一诊断、解析并通过异步任务生成研究故事线", async ({ page }) => {
  await mockCommonPptxApis(page);
  const operations = new Map();
  let jobSequence = 0;

  await page.route(/\/(?:pptx-api|api\/pptx-report)\/ai-jobs$/, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON();
    const jobId = `ai-job-${++jobSequence}`;
    operations.set(jobId, body.operation);
    return json(route, { job_id: jobId, status: "queued", progress: 4, message: "任务已创建" });
  });
  await page.route(/\/(?:pptx-api|api\/pptx-report)\/ai-jobs\/[^/?]+(?:\?.*)?$/, (route) => {
    const jobId = route.request().url().split("/").pop();
    const operation = operations.get(jobId) || "";
    let payload;
    if (operation === "report_narrative_framework") {
      payload = {
        report_title: "Sprint 3 回归报告",
        central_thesis: "概念具备转化基础，但仍需围绕核心需求降低购买障碍。",
        storyline_type: "problem_solution",
        chapters: [
          { chapter_id: "chapter_01", title: "概念表现与转化潜力", purpose: "判断概念是否成立", key_question: "概念能否形成购买动力？" },
          { chapter_id: "chapter_02", title: "核心人群与需求基础", purpose: "解释产品与需求的匹配", key_question: "哪些需求最值得优先满足？" },
          { chapter_id: "chapter_03", title: "障碍化解与行动优先级", purpose: "明确转化阻力与行动", key_question: "如何降低购买障碍？" },
        ],
      };
    } else {
      const pageIds = operation.match(/\d+/g)?.slice(1).map(Number) || [1, 2, 3];
      payload = {
        assignments: pageIds.map((pageIdx) => ({
          page_idx: pageIdx,
          chapter_id: `chapter_0${pageIdx}`,
          theme_id: `theme_0${pageIdx}`,
          chapter_reason: "该页面直接回答对应研究问题。",
        })),
      };
    }
    return json(route, {
      status: "ready",
      progress: 100,
      message: "AI 任务完成",
      diagnostics: {
        model: "e2e-model",
        source: "builtin-surveykit-gateway",
        task_tier: "storyline",
        duration_ms: 120,
      },
      result: { choices: [{ message: { content: JSON.stringify(payload) } }] },
    });
  });

  await openPptxReport(page);
  await uploadAndParse(page);
  await page.locator("#pptxPlanningMode").selectOption("ai");
  await page.locator("#pptxPreviewBtn").click();

  await expect(page.locator("#pptxNarrativePanel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#pptxNarrativeContent")).toContainText("概念表现与转化潜力");
  await expect(page.locator("#pptxNarrativeContent")).toContainText("障碍化解与行动优先级");
  await expect(page.locator("#pptxAiWriteStatus")).toContainText("AI 故事线已返回");
  expect([...operations.values()]).toContain("report_narrative_framework");
  expect([...operations.values()].some((value) => value.startsWith("report_narrative_assignment_"))).toBeTruthy();
});

test("快速报告通过异步任务生成并下载 PPTX", async ({ page }, testInfo) => {
  await mockCommonPptxApis(page);
  await page.route(/\/(?:pptx-api|api\/pptx-report)\/jobs$/, (route) => json(route, {
    job_id: "pptx-job-e2e",
    status: "queued",
    progress: 8,
    message: "任务已创建",
  }));
  await page.route(/\/(?:pptx-api|api\/pptx-report)\/jobs\/pptx-job-e2e$/, (route) => json(route, {
    job_id: "pptx-job-e2e",
    status: "ready",
    progress: 100,
    message: "报告已生成",
    overall_score: 98,
    qa: { score: 98, error_count: 0, warning_count: 0, issues: [], slide_count: 9 },
  }));
  const pptxBytes = Buffer.from("PK\u0003\u0004surveykit-sprint3-e2e");
  await page.route(/\/(?:pptx-api|api\/pptx-report)\/jobs\/pptx-job-e2e\/download(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Length": String(pptxBytes.length),
      "Content-Disposition": 'attachment; filename="sprint3-e2e.pptx"',
    },
    body: pptxBytes,
  }));

  await openPptxReport(page);
  await uploadAndParse(page);
  await page.locator("#pptxPlanningMode").selectOption("rule");
  await page.locator("#pptxPreviewBtn").click();
  await expect(page.locator("#pptxConfirmBtn")).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#pptxConfirmBtn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
  const outputPath = testInfo.outputPath("sprint3-e2e.pptx");
  await download.saveAs(outputPath);
  expect((await fs.stat(outputPath)).size).toBe(pptxBytes.length);
  await expect(page.locator("#pptxResult")).toContainText("生成成功");
  await expect(page.locator("#pptxProgressText")).toContainText("100%");
});
