const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const blue = JSON.parse(fs.readFileSync(path.join(root, "pptx_report/templates/research-business-blue-v1/layout_catalog.json")));
const legacy = { ...JSON.parse(fs.readFileSync(path.join(root, "pptx_report/templates/qualitative-tech-blue-v2/layout_catalog.json"))), name: "Tech Blue V2" };
const png = fs.readFileSync(path.join(root, "templates/research-business-blue-v1/actions.png")).toString("base64");
const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

test("template switch, rollback, lock, save/export and reopen preserve the selected design", async ({ page }, testInfo) => {
  const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  const project = { id: "p1", title: "蓝色商务接入验收", constraints: {} };
  const script = { schema_version: "surveykit.ppt_script.v1", title: "研究报告脚本", source_report_outline_id: "outline", style_profile: { id: legacy.template_id, version: legacy.version }, pages: [{ id: "page1", page_number: 1, page_type: "recommendation", title: "透明规则与可撤回操作降低决策负担", key_message: "优先解释关键规则", source_notes: "验收演示证据", evidence_ids: ["e1"], content_structure: [{ title: "规则说明", body: "提交之前解释条件" }, { title: "保留控制", body: "允许返回修改" }] }] };
  let artifacts = [{ id: "analysis", type: "qualitative_analysis", title: "访谈分析", version: 1, content: "{}" }, { id: "outline", type: "report_outline", title: "报告大纲", version: 1, content: "{}" }, { id: "script", type: "ppt_script", title: "研究报告脚本", version: 1, content: JSON.stringify(script) }];
  const requests = []; let failNext = false;
  await page.addInitScript(() => localStorage.setItem("surveykit_tour_done", "1"));
  await page.route("**/api/research/**", async (route) => {
    const url = new URL(route.request().url()); const tail = url.pathname.split("/").pop();
    if (tail === "projects") return json(route, { projects: [project] });
    if (tail === "p1") return json(route, { project });
    if (tail === "artifacts") {
      if (route.request().method() === "POST") { const body = route.request().postDataJSON(); const artifact = { ...body, id: `saved_${artifacts.length}`, version: 2 }; artifacts = [...artifacts, artifact]; return json(route, { artifact }); }
      return json(route, { artifacts });
    }
    if (tail === "files" && route.request().method() === "POST") return json(route, { file: { id: "ppt_file", file_name: "研究报告.pptx" } });
    if (tail === "evidence") return json(route, { evidence: [{ id: "e1", type: "qualitative", strength: "strong", claim: "用户希望先知道规则", value: {} }] });
    return json(route, { [tail]: [] });
  });
  await page.route("**/pptx-api/qualitative-templates", (route) => json(route, { default_template_id: legacy.template_id, templates: [legacy, blue], renderer: { officecli_installed: true } }));
  await page.route("**/pptx-api/qualitative-preview", (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (failNext) { failNext = false; return json(route, { error: { message: "测试：预览服务暂时不可用" } }, 503); }
    const pack = body.template_id === blue.template_id ? blue : legacy;
    const p = body.script.pages[0]; const variant = p.layout_variant || (pack === blue ? "bb_actions" : "action_roadmap");
    return json(route, { script_fingerprint: JSON.stringify(body.script), slide_count: 1, validation: { error_count: 0 }, quality_gate: { passed: true }, renderer: { engine: "officecli" }, slides: [{ page_id: p.id, source_page_id: p.id, page_number: 1, title: p.title, page_type: p.page_type, layout_variant: variant, source_layout_variant: variant, layout_candidates: pack.layouts.filter((l) => l.page_types.includes(p.page_type)), thumbnail_base64: png, evidence: { ids: ["e1"], count: 1 }, validation_issues: [] }] });
  });
  await page.route("**/pptx-api/qualitative-report", (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    return json(route, { template_id: body.template_id, template_name: blue.name, template_version: blue.version, filename: "研究报告.pptx", content_base64: "UEsDBA==", slide_count: 1, renderer: { engine: "officecli" }, quality_gate: { passed: true }, validation: { issue_count: 0 }, object_counts: { full_slide_images: 0 } });
  });
  await page.goto("/#research");
  await page.locator(".research-project-card").filter({ hasText: project.title }).click();
  const artifactsTab = page.locator('[data-research-tab="artifacts"]');
  if (await artifactsTab.isVisible()) await artifactsTab.click();
  const card = page.locator(".research-artifact-card").filter({ has: page.locator("h5", { hasText: "研究报告脚本" }) }).first();
  await card.getByRole("button", { name: "生成定性报告PPT", exact: true }).click();
  const picker = page.locator("#researchPptTemplateSelect");
  await expect(page.locator("#researchPptPreviewConfirm")).toBeEnabled();
  failNext = true;
  await picker.selectOption(blue.template_id);
  await expect(picker).toHaveValue(legacy.template_id);
  await expect(page.locator("#researchPptPreviewConfirm")).toBeEnabled();
  await picker.selectOption(blue.template_id);
  await expect(page.locator("#researchPptTemplateName")).toContainText(blue.name);
  await expect(page.locator("#researchPptTemplateExamples img")).toHaveCount(6);
  const layout = page.locator(".research-ppt-page-layout select");
  await layout.selectOption("bb_roadmap");
  await expect(layout).toHaveValue("bb_roadmap");
  await page.getByRole("button", { name: "锁定版式", exact: true }).click();
  await expect(layout).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.locator("#researchPptPreviewConfirm").click(); await download;
  const savedScript = artifacts.find((a) => a.id.startsWith("saved_") && a.type === "ppt_script");
  expect(savedScript).toBeTruthy();
  expect(JSON.parse(savedScript.content).pages[0].layout_binding.locked).toBe(true);
  expect(JSON.parse(savedScript.content).style_profile.id).toBe(blue.template_id);
  const metadata = JSON.parse(artifacts.find((a) => a.type === "qualitative_ppt").content);
  expect(metadata.template_version).toBe(blue.version);
  expect(metadata.source_ppt_script).toBe(savedScript.id);
  expect(requests.at(-1).script.pages[0].layout_variant).toBe("bb_roadmap");
  const newCard = page.locator(".research-artifact-card").filter({ has: page.getByRole("button", { name: "生成定性报告PPT", exact: true }) }).last();
  await newCard.getByRole("button", { name: "生成定性报告PPT", exact: true }).click();
  await expect(picker).toHaveValue(blue.template_id);
  await expect(page.locator("#researchPptPreviewConfirm")).toBeEnabled();
  await expect(page.locator(".research-ppt-page-layout select")).toBeDisabled();
  await page.locator("#researchQualitativePptPreviewDialog").screenshot({ path: testInfo.outputPath("business-blue-preview.png") });
  expect(pageErrors).toEqual([]);
});
