import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const moduleSource = fs.readFileSync(path.join(root, "src/modules/ai-researcher/index.js"), "utf8");
assert.match(html, /data-research-task-type="qualitative_excel_summary"/);
assert.match(html, /id="researchFileDownload"/);
assert.match(moduleSource, /structure_kind === "qualitative_summary_template"/);
assert.match(moduleSource, /下载 Excel 小结/);
assert.match(moduleSource, /\/files\/\$\{encodeURIComponent\(file\.id\)\}\/download/);
console.log("qualitative excel UI smoke passed");
