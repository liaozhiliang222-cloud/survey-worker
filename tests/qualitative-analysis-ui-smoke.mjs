import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/modules/ai-researcher/index.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(html, /id="researchTranscriptList"/);
assert.match(html, /data-research-task-type="qualitative_analysis"/);
assert.match(html, /data-research-task-type="interview_summary"/);
assert.match(html, /data-research-task-type="find_quotes"/);
assert.match(html, /value="qualitative_analysis">多访谈定性分析/);
assert.match(html, /id="researchTranscriptMetadata"/);
assert.match(html, /id="researchGenerateTranscriptSummaries"/);
assert.match(html, /id="researchGenerateTranscriptSummary"/);
assert.match(html, /id="researchTranscriptDeepSummary"/);
assert.match(ui, /\/transcripts\/\$\{encodeURIComponent\(transcriptId\)\}\/segments\//);
assert.match(ui, /查看原文上下文/);
assert.match(ui, /raw text|Segment 原文校验|原文将由 Segment 工具按需检索/);
assert.match(ui, /loadEvidence/);
assert.match(ui, /requestTranscriptSummary/);
assert.match(ui, /Math\.min\(2, queue\.length\)/);
assert.match(css, /\.research-evidence-context p\.target/);
assert.match(css, /\.research-transcript-item/);
assert.match(css, /\.research-transcript-summary-cache/);

console.log("qualitative-analysis-ui-smoke: PASS");
