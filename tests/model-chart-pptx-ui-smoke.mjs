import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const backend = fs.readFileSync(path.join(root, "deploy", "aliyun_api.py"), "utf8");

for (const id of [
  "exportPsmPptx",
  "exportKanoPptx",
  "exportMaxDiffPptx",
  "exportDriverPptx",
]) {
  assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, new RegExp(`#${id}`));
}

assert.equal((html.match(/导出可编辑 PPT/g) || []).length, 4);
assert.match(app, /async function exportResearchModelPptx/);
assert.match(app, /fetch\("\/pptx-api\/model-chart"/);
assert.match(app, /model_type: modelType/);
assert.match(backend, /@app\.post\("\/api\/pptx-report\/model-chart"\)/);
assert.doesNotMatch(app, /exportSvgChartAsPng/);
assert.doesNotMatch(html, /导出图表 PNG|导出 PNG/);
assert.equal((html.match(/下载 Excel 模板/g) || []).length, 6);
assert.match(app, /kanoSummaryFromRawWorkbook/);
assert.match(app, /meanWorse/);
assert.match(app, /meanBetter/);

console.log("editable model chart PPTX UI/API smoke: ok");
