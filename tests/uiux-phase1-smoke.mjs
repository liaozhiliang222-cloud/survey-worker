import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const html = read("index.html");
const css = read("styles.css");
const app = read("app.js");

// 手机导航：560px 以下不能再把抽屉里的 .nav / .nav-group 改成横排（会导致文字逐字竖排）。
for (const block of css.matchAll(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/g)) {
  assert.doesNotMatch(block[1], /^\s*\.nav(?:-group)?\s*\{/m, "560px 媒体查询不能覆盖 .nav / .nav-group 布局");
  assert.doesNotMatch(block[1], /^\s*\.nav-phase\s*\{\s*display:\s*none/m, "手机抽屉需要显示分组标题");
}
assert.match(css, /\.sidebar \.nav-item \{\s*min-height: 44px;/, "抽屉菜单项点击高度至少 44px");

// 页面标题与导航名一致。
const navLabel = (view) => html.match(new RegExp(`data-view="${view}"[^>]*>(?:<strong>)?([^<]+)`))?.[1].trim();
const pageTitle = (view) => {
  const section = html.slice(html.indexOf(`id="${view}"`));
  return section.match(/<h2[^>]*>\s*(?:<span>)?([^<]+)/)?.[1].trim();
};
for (const view of ["sample", "quota", "link-test", "time-estimate", "cleaning-rules", "table-header", "crosstab-analysis", "pptx-report", "data-weighting"]) {
  assert.equal(pageTitle(view), navLabel(view), `${view} 的页面标题应与导航名一致`);
}

// 不可用按钮都写明原因，并由通用脚本展示。
const reasons = [...html.matchAll(/<button\b[^>]*\bdata-disabled-reason="([^"]+)"/g)].map((match) => match[1]);
assert.ok(reasons.length >= 20, `expected disabled reasons, got ${reasons.length}`);
for (const reason of reasons) assert.ok(reason.length >= 4, `原因过短：${reason}`);
for (const id of ["generateCleaningRulesFromData", "executeCleaning", "downloadCleanedData", "exportWeighting", "exportAudit", "pptxParseBtn", "copyAiPrompt"]) {
  assert.match(html, new RegExp(`id="${id}"[^>]*data-disabled-reason=`), `${id} 缺少不可用原因`);
}
assert.match(app, /function syncDisabledReasonHints\(\)/);
assert.match(app, /attributeFilter: \["disabled"\]/);

// 交叉表“生成并下载”：结果区滚入视口，成功和失败都有提示，可再次下载。
assert.match(html, />生成并下载全部题目表</);
assert.match(app, /revealCrosstabResults\(\);\n\s*void nextUiTick\(\)\.then\(generateQuestionPivot\)/);
assert.match(app, /showToast\(`已生成 \$\{lastQuestionPivot\.length\} 题交叉表，并下载《\$\{filename\}》`, "success"\)/);
assert.match(app, /showToast\(`交叉表生成失败：/);
assert.match(app, /data-crosstab-redownload/);

// 新手引导与首页推荐一致：3 步，从项目开始。
const tour = app.slice(app.indexOf("function initTooltipTour"), app.indexOf("let currentStep = 0;"));
assert.equal([...tour.matchAll(/selector:/g)].length, 3);
assert.match(tour, /selector: "#workspaceNewProject"/);
assert.doesNotMatch(tour, /从「样本量计算」开始/);

console.log("uiux-phase1-smoke: PASS");
