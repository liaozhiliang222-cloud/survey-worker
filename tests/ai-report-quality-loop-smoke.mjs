import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

[
  "pptxReportQualityPanel",
  "pptxReportQualityTitle",
  "pptxReportQualitySummary",
  "pptxReportQualityScore",
  "pptxReportQualityIssues",
  "pptxReportQualityNote",
  "pptxRepairQualityBtn",
].forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`)));
assert.match(styles, /\.pptx-report-quality\.blocked/);
assert.match(styles, /\.pptx-report-quality\.review/);
assert.match(styles, /\.pptx-brief-badge\.quality-error/);
assert.match(styles, /\.pptx-brief-badge\.quality-warning/);

assert.match(app, /function refreshPptxReportQuality/);
assert.match(app, /buildReportQualityGate/);
assert.match(app, /function renderPptxReportQualityGate/);
assert.match(app, /function reportQualityIssuesByPage/);
assert.match(app, /quality-error/);
assert.match(app, /quality-warning/);

const repairStart = app.indexOf("async function repairPptxReportQuality");
const repairEnd = app.indexOf("async function regenerateSinglePptxSlide", repairStart);
assert.ok(repairStart >= 0 && repairEnd > repairStart);
const repairFlow = app.slice(repairStart, repairEnd);
assert.match(repairFlow, /repairable_page_idxs/);
assert.match(repairFlow, /targetSlideIds/);
assert.match(repairFlow, /applyQuestionPlan: false/);
assert.match(repairFlow, /applyDimensionPlan: false/);
assert.match(repairFlow, /applyNarrativeOrder: false/);
assert.match(repairFlow, /qualityRepair: true/);
assert.match(repairFlow, /pushPptxPlanHistory\(\)/);
assert.doesNotMatch(repairFlow, /generatePptxAiReport/);

const briefStart = app.indexOf("async function generatePptxSlideBriefs");
const briefEnd = app.indexOf("async function repairPptxReportQuality", briefStart);
assert.ok(briefStart >= 0 && briefEnd > briefStart);
const briefFlow = app.slice(briefStart, briefEnd);
assert.match(briefFlow, /filterWritablePages\(contextPages\)/);
assert.match(briefFlow, /targetSlideIds\.has\(pptxPageStableId\(page\)\)/);
assert.match(briefFlow, /phase === "quality_repair"/);
assert.match(briefFlow, /仅修复这些质检问题页/);

const generateStart = app.indexOf("async function doGeneratePptx");
const generateEnd = app.indexOf('cancelJobBtn?.addEventListener("click"', generateStart);
assert.ok(generateStart >= 0 && generateEnd > generateStart);
const generateFlow = app.slice(generateStart, generateEnd);
const qualityGatePosition = generateFlow.indexOf("refreshPptxReportQuality");
const fileReadPosition = generateFlow.indexOf("selectedFile.arrayBuffer");
assert.ok(qualityGatePosition >= 0, "PPT generation must run the quality gate");
assert.ok(fileReadPosition > qualityGatePosition, "Quality gate must run before reading/uploading the source file");
assert.match(generateFlow, /qualityGate\?\.status === "blocked"/);
assert.match(generateFlow, /qualityGate\?\.requires_confirmation/);
assert.match(generateFlow, /window\.confirm/);
assert.match(generateFlow, /reportQualityOverrideSignature = qualityGate\.signature/);

assert.match(app, /repairQualityBtn\?\.addEventListener\("click"/);
console.log("AI report quality loop smoke tests passed.");
