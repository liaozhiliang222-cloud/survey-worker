import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(html, /data-research-task-type="transcript_correction"[^>]*>笔录校正</);
assert.match(html, /id="researchTranscriptCorrectionDialog"/);
assert.match(html, /id="researchCorrectionReviewList"/);
assert.match(html, /id="researchCorrectionExport"[^>]*>导出校正版 DOCX</);
assert.match(js, /requestTranscriptCorrection/);
assert.match(js, /reviewTranscriptCorrection/);
assert.match(js, /raw_content/);
assert.match(js, /exportCorrectedTranscript/);
assert.match(css, /research-correction-diff/);

console.log("transcript correction ui smoke: ok");
