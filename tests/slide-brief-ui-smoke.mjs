import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const backend = fs.readFileSync(path.join(root, "deploy", "aliyun_api.py"), "utf8");

for (const field of ["slide_claim", "slide_type", "layout_family", "slide_locked"]) {
  assert.match(app, new RegExp(`data-field="${field}"`));
}
assert.match(html, /id="pptxContinueEditBtn"/);
assert.match(app, /user_modified/);
assert.match(app, /mergeSlideBriefSuggestion/);
assert.match(app, /persistSlideOrder/);
assert.match(app, /deleteSlideBriefRemote/);
assert.match(app, /data-pptx-action="regenerate-slide"/);
assert.match(app, /async function regenerateSinglePptxSlide/);
assert.match(app, /force_user_modified: forceUserModified/);
assert.match(app, /brief.locked/);
assert.match(app, /window.confirm/);

const confirmStart = app.indexOf("async function confirmReportNarrativeAndGenerate()");
const generateStart = app.indexOf("async function doGeneratePptx()", confirmStart);
assert.ok(confirmStart >= 0 && generateStart > confirmStart);
const confirmFlow = app.slice(confirmStart, generateStart);
assert.doesNotMatch(confirmFlow, /await doGeneratePptx/);
assert.match(confirmFlow, /persistSlideBriefBlueprint/);
assert.match(confirmFlow, /确认并生成 PPT/);
const batchStart = app.indexOf("async function generatePptxSlideBriefs(reportNarrative)");
const singleStart = app.indexOf("async function regenerateSinglePptxSlide", batchStart);
assert.ok(batchStart >= 0 && singleStart > batchStart);
const batchFlow = app.slice(batchStart, singleStart);
assert.match(batchFlow, /filterWritablePages/);
assert.match(batchFlow, /chunkPagesByChapter/);
assert.match(batchFlow, /mapWithConcurrency/);
assert.match(batchFlow, /SLIDE_BRIEF_CONCURRENCY/);
assert.match(batchFlow, /maxTokens: 5000/);
assert.match(batchFlow, /repair_instruction/);
assert.match(batchFlow, /lastPptxSlideBriefStats/);
assert.doesNotMatch(batchFlow, /content: String\(output\)\.slice/);

const generateFlow = app.slice(generateStart, app.indexOf("cancelJobBtn", generateStart));
assert.ok(generateFlow.indexOf("persistSlideBriefBlueprint") < generateFlow.indexOf("selectedFile.arrayBuffer"));

for (const route of [
  "/api/report/{report_id}/slide-briefs",
  "/api/report/{report_id}/slide/{slide_id}",
  "/api/report/{report_id}/slides/reorder",
  "/api/report/{report_id}/slide/{slide_id}/regenerate",
]) {
  assert.ok(backend.includes(route));
}
console.log("slide brief UI/API smoke: ok");
