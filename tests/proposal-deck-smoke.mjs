import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../proposal-deck.js", import.meta.url), "utf8");
const sandbox = {
  window: {},
  document: { querySelector: () => null },
  console, Date, Math, JSON, setTimeout, clearTimeout,
  escapeHtml: (value) => String(value),
  aiPlanModules: () => ["场景与行为", "需求与痛点", "概念反馈"],
  aiPlanProjectName: (config) => config.project || "待命名调研项目",
  aiPlanStudyTypeName: () => "概念/新品测试",
  aiPlanAdditionalModuleNames: () => ["价格接受度"],
  loadWorkspaceProject: () => ({ id: "project_test" })
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = sandbox.window.ProposalDeck;

assert.equal(api.STORY_TIMEOUT_MS, 180000);
assert.equal(api.PAGE_CONTENT_TIMEOUT_MS, 300000);

const repaired = api.parseJsonCandidate('```json\n{"slides": [{"title": "测试",}],}\n```');
assert.equal(repaired.slides[0].title, "测试");

const overlong = api.normalizeDeck({
  deck_id: "deck_test",
  project_id: "project_test",
  title: "测试方案",
  slides: [
    { id: "cover", title: "测试方案", visual_type: "cover_minimal", content: [] },
    { id: "long", title: "研究内容", visual_type: "invented_flow", content: Array.from({ length: 8 }, (_, index) => ({ headline: `内容${index + 1}` })) }
  ]
});
assert.equal(overlong.slides.length, 3, "Overlong content should split into continuation pages.");
assert.equal(overlong.slides[1].visual_type, "dual_track_research_flow");
assert.equal(overlong.slides[1].content.length, 6);
assert.equal(overlong.slides[2].content.length, 2);

const config = {
  project: "智能宠物饮水机新品概念测试",
  brief: "验证概念吸引力、卖点偏好、购买意愿、价格接受度、目标人群分层与营销建议。",
  studyType: "concept",
  additionalModules: ["pricing", "segmentation", "conversion", "channel"],
  audience: "城市养宠家庭的购买决策者",
  sampleSize: 700,
  timeline: "2周内完成",
  ppt: { pageSize: 12, purpose: "client_proposal", exampleOutputMode: "illustrative", contentDensity: "professional", includeQuota: true, includeRisks: true, includeOutputs: true, includePricing: false, includeTeam: false }
};
const localDeck = api.buildLocalDeck(config, api.buildLocalStory(config), "已确认的 Word 详细方案");
assert.equal(localDeck.slides.length, 12);
assert.equal(localDeck.aspect_ratio, "16:9");
assert.equal(localDeck.theme, "modern_insight_v2");
assert.ok(new Set(localDeck.slides.map((slide) => slide.visual_type)).size >= 10);
assert.ok(localDeck.slides.filter((slide) => ["deliverable_map", "plan_comparison", "pricing_table"].includes(slide.visual_type)).length <= 2);
assert.equal(localDeck.slides[7].content.length, 7, "Questionnaire title and module count must match.");
assert.equal(localDeck.slides.filter((slide) => slide.example_output).length, 2);
assert.equal(localDeck.slides[8].charts[0].dataset_id, localDeck.slides[9].charts[0].dataset_id);
assert.equal(localDeck.illustrative_dataset.data_status, "illustrative");
assert.equal(localDeck.illustrative_dataset.usable_for_decision, false);
assert.ok(localDeck.illustrative_dataset.disclaimer.includes("不代表实际研究结果"));
assert.deepEqual(Object.values(localDeck.illustrative_dataset.metrics), [82, 68, 61, 55, 39]);
assert.equal(Object.values(localDeck.illustrative_dataset.selling_point_scores).reduce((a, b) => a + b, 0), 100);
assert.ok(new Set(localDeck.slides[11].timeline_tasks.map((task) => task.start_day)).size > 1, "Gantt tasks must not all start together.");
assert.equal(api.validateDeck(localDeck).filter((issue) => issue.level === "error").length, 0);

const aiCalls = [];
const progress = [];
sandbox.loadAiSettings = () => ({ mode: "proxy", model: "test" });
sandbox.callAiChatCompletion = async (_settings, _messages, options) => {
  aiCalls.push(options);
  throw new Error("AI 请求超时");
};
api.state.generating = false;
await api.generate(config, "已确认的 Word 详细方案", {
  onProgress: (entry) => progress.push(entry)
});
assert.deepEqual(aiCalls.map((entry) => entry.timeoutMs), [180000, 300000]);
assert.deepEqual([...new Set(progress.map((entry) => entry.step))], [0, 1, 2, 3, 4]);
assert.match(progress.findLast((entry) => entry.step === 1).message, /180 秒/);
assert.match(progress.findLast((entry) => entry.step === 2).message, /300 秒/);
assert.equal(api.state.generating, false);

const previewCanvas = { className: "", innerHTML: "" };
sandbox.document.querySelector = (selector) => selector === "#proposalDeckCanvas" ? previewCanvas : null;
api.state.deck = localDeck;
api.state.selectedSlideId = localDeck.slides[8].id;
api.renderCanvas();
assert.match(previewCanvas.innerHTML, /REPORT EXAMPLE/);
assert.match(previewCanvas.innerHTML, /82%/);
assert.match(previewCanvas.innerHTML, /不代表实际研究结果/);

api.state.deck = localDeck;
api.state.selectedSlideId = localDeck.slides[1].id;
api.state.deck.slides[1].locked = true;
const before = JSON.stringify(api.state.deck);
await api.regenerateSlide();
assert.equal(JSON.stringify(api.state.deck), before, "Locked slide regeneration must not mutate the deck.");

const originalOtherPage = structuredClone(localDeck.slides[2]);
const replaced = api.replaceSlidePreservingLocks(localDeck, localDeck.slides[3].id, {
  ...localDeck.slides[3],
  title: "重新生成后的研究决策页",
  key_message: "仅替换当前页，其他页面保持不变。"
});
assert.equal(replaced.slides[3].title, "重新生成后的研究决策页");
assert.deepEqual(replaced.slides[2], originalOtherPage, "Single-page regeneration must preserve other pages.");
assert.notEqual(replaced, localDeck, "Single-page regeneration must return a new deck.");

assert.match(source, /PPT 导出失败/);
assert.match(source, /无来源支持的比例数字/);
console.log("Proposal Deck frontend tests passed.");
