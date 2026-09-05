import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
const stream = fs.readFileSync(new URL("../src/modules/ai-researcher/stream.mjs", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0008_research_plan_workflows.sql", import.meta.url), "utf8");

assert.match(html, /id="researchWorkflowPanel"/);
assert.match(html, /id="researchCurrentArtifact"/);
assert.match(html, /id="researchProjectBudget"/);
assert.match(html, /id="researchProjectTimeline"/);
assert.match(ui, /loadWorkflows\(\)/);
assert.match(ui, /onWorkflowStatus/);
assert.match(ui, /error\.type = run\.error\?\.type/);
assert.match(ui, /本轮处理已达到时限/);
assert.match(ui, /body\.task_type === "data_analysis"/);
assert.match(ui, /查看完整方案/);
assert.match(ui, /继续修改/);
assert.match(ui, /state\.taskType === "research_plan"\) sendMessage/);
assert.match(stream, /workflow_status/);
assert.match(css, /\.research-workflow-steps/);
assert.match(migration, /waiting_input/);
assert.match(migration, /tool_result_ids/);
assert.match(migration, /UNIQUE\(project_id, client_request_id\)/);
console.log("research plan workflow UI smoke: PASS");
