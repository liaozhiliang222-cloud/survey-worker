import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../functions/pptx-api/_proxy.js", import.meta.url), "utf8");

assert.match(html, /id="pptxCancelJobBtn"/);
assert.match(app, /X-SurveyKit-Client-ID/);
assert.match(app, /jobs\/\$\{encodeURIComponent\(jobId\)\}\/cancel/);
assert.match(app, /download\?delete_after=true/);
assert.match(app, /setPptxCancelState\(Boolean\(lastPptxJobId\)\)/);
assert.match(app, /const readyState = await waitForPptxJob\(job\.job_id\);\s*setPptxCancelState\(false\)/);
assert.match(app, /if \(!lastPptxJobId \|\| cancelJobBtn\.disabled\) return/);
assert.match(app, /\["failed", "cancelled", "lost"\]/);
assert.match(app, /readyState\.overall_score/);
assert.match(app, /duplicate_divider_lines/);
assert.match(app, /pptx-qa-details/);
assert.doesNotMatch(app, /真实预览|class="pptx-real-preview|data-pptx-action="render-preview"|data-pptx-action="close-preview"/);
assert.doesNotMatch(app, /window\.open\(url, "_blank"/);
assert.match(app, /综合QA/);
assert.match(proxy, /X-SurveyKit-Client-ID/);
console.log("PPT async job UI smoke passed: lifecycle, object QA, download and blueprint controls.");
