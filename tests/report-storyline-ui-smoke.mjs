import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const localHandler = fs.readFileSync(new URL("../lib/research-handler.js", import.meta.url), "utf8");
const cloudflareHandler = fs.readFileSync(new URL("../functions/api/research/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0017_report_storyline_workflow.sql", import.meta.url), "utf8");

assert.match(html, /data-research-task-type="report_storyline"/);
assert.match(html, /<option value="report_outline">报告大纲<\/option>/);
assert.match(ui, /Evidence Coverage/);
assert.match(ui, /锁定结论/);
assert.match(ui, /排除 Evidence/);
assert.match(ui, /基于最新证据更新报告大纲/);
assert.match(ui, /报告大纲工作流/);
assert.match(css, /research-outline-page\.status-needs_supplement/);
assert.match(localHandler, /formalReport/);
assert.match(cloudflareHandler, /formalReport/);
assert.match(migration, /report_outline/);
assert.match(migration, /report_storyline/);
assert.match(migration, /research_evidence_conflicts/);
assert.match(migration, /research_evidence_gaps/);
console.log("report-storyline-ui-smoke: ok");

