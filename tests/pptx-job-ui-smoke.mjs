import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../functions/pptx-api/_proxy.js", import.meta.url), "utf8");

assert.match(html, /id="pptxCancelJobBtn"/);
assert.match(app, /X-SurveyKit-Client-ID/);
assert.match(app, /jobs\/\$\{encodeURIComponent\(lastPptxJobId\)\}\/cancel/);
assert.match(app, /download\?delete_after=true/);
assert.match(app, /\["failed", "cancelled", "lost"\]/);
assert.match(app, /readyState\.overall_score/);
assert.match(app, /对象QA/);
assert.match(proxy, /X-SurveyKit-Client-ID/);
console.log("PPT async job UI smoke passed.");