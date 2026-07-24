import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const api = readFileSync(new URL("../deploy/aliyun_api.py", import.meta.url), "utf8");

assert.match(html, /id="pptxTemplateProfileImport"/);
assert.match(html, /id="pptxTemplateProfileExport"/);
assert.match(html, /id="pptxTemplateProfileInput"[^>]+accept="application\/json,\.json"/);
assert.match(app, /async function exportPptxTemplateProfile/);
assert.match(app, /new Blob\(\[JSON\.stringify\(profile, null, 2\)\]/);
assert.match(app, /file\.size > 1024 \* 1024/);
assert.match(app, /savePptxTemplateProfile\(profile\)/);
assert.match(app, /安全区已按当前模板重新计算/);
assert.match(api, /value\["slide_index"\]\) \+ 1/);
assert.match(api, /Profile JSON 不能超过 1MB/);
assert.match(api, /"font_mapping": \{\}/);
console.log("PPT template Profile UI smoke passed: import, export, validation and API compatibility");
