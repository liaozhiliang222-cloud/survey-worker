import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../functions/pptx-api/_proxy.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(html, /id="pptxCancelJobBtn"/);
assert.match(app, /X-SurveyKit-Client-ID/);
assert.match(app, /jobs\/\$\{encodeURIComponent\(lastPptxJobId\)\}\/cancel/);
assert.match(app, /download\?delete_after=true/);
assert.match(app, /\["failed", "cancelled", "lost"\]/);
assert.match(app, /readyState\.overall_score/);
assert.match(app, /duplicate_divider_lines/);
assert.match(app, /pptx-qa-details/);
assert.match(app, /visualQa\.status === "completed"/);
assert.match(app, /class="pptx-real-preview/);
assert.match(app, /panel\.dataset\.pptxPreviewUrl = url/);
assert.match(app, /frame\.src = `\$\{url\}#toolbar=0&navpanes=0&view=FitH`/);
assert.match(app, /data-pptx-action="close-preview"/);
assert.match(app, /URL\.revokeObjectURL\(panel\.dataset\.pptxPreviewUrl\)/);
assert.doesNotMatch(app, /window\.open\(url, "_blank"/);
assert.match(styles, /\.pptx-real-preview iframe/);
assert.match(app, /图片级视觉 QA/);
assert.match(app, /综合QA/);
assert.match(proxy, /X-SurveyKit-Client-ID/);
console.log("PPT async job UI smoke passed.");
