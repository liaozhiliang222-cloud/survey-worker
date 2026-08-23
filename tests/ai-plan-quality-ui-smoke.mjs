import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");

const generateStart = app.indexOf("async function generateAiPlan()");
const generateEnd = app.indexOf("function buildAiPlanRevisionPrompt", generateStart);
const generateBody = app.slice(generateStart, generateEnd);
assert.ok(generateStart >= 0 && generateEnd > generateStart);
assert.equal((generateBody.match(/callAiChatCompletion\(/g) || []).length, 1, "Default plan generation must keep one AI call.");
assert.doesNotMatch(generateBody, /repairAiPlanQuality\(|buildRepairInstruction\(/, "Default generation must not trigger repair.");

const repairStart = app.indexOf("async function repairAiPlanQuality()");
const repairEnd = app.indexOf("async function copyAiPlan", repairStart);
const repairBody = app.slice(repairStart, repairEnd);
assert.match(repairBody, /buildRepairInstruction/);
assert.match(repairBody, /await reviseAiPlan\(\)/);

assert.match(app, /auditAiPlanOutput\(output, config\)/);
assert.match(app, /本地结构审校/);
assert.match(html, /id="repairAiPlanQuality"[^>]*disabled/);
assert.match(html, /ai-plan-quality\.js[^<]*<\/script>[\s\S]*ppt-report-ai\.js/);
assert.match(viteConfig, /"ai-plan-quality\.js"/, "Production build must copy the quality runtime.");

console.log("AI plan quality UI smoke test passed.");
