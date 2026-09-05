import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const local = fs.readFileSync(new URL("../lib/research-handler.js", import.meta.url), "utf8");
const cloud = fs.readFileSync(new URL("../functions/api/research/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0018_ppt_script_workflow.sql", import.meta.url), "utf8");

assert.match(html, /<option value="ppt_script">PPT 脚本<\/option>/);
for (const label of ["生成 PPT 脚本", "让 AI 优化此页", "新增页面", "Evidence IDs", "Visual Type", "Layout Spec", "删除"]) assert.match(ui, new RegExp(label));
assert.match(ui, /movePptScriptPage/);
assert.match(ui, /appendOutlineEvidence\(card, page\.evidence_ids\)/);
assert.match(ui, /targetPptScriptPageId/);
assert.match(ui, /\["ppt_script", "qualitative_ppt"\]\.includes\(artifact\.type\)/);
assert.match(css, /research-ppt-script-page\.density-overloaded/);
assert.match(local, /formalScript/);
assert.match(local, /allowed_tools: \[\]/);
assert.match(cloud, /formalScript/);
assert.match(migration, /'ppt_script'/);
console.log("ppt-script-ui-smoke: ok");
