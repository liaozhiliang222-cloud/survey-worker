import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(source, /function currentPptxStatusElement\(\)/, "generation feedback must target the visible step");
assert.match(source, /pptxGenerationRunning/, "concurrent generation must be guarded");
assert.match(source, /hasGeneratedPptx \? "[^"]+ PPT" : "[^"]+ PPT"/, "quick mode must expose regeneration");
assert.match(source, /generation_nonce:/, "each generation attempt must have a unique request fingerprint");
assert.match(source, /data-pptx-action="toggle-sort-desc"/, "every page card must expose the descending-sort toggle");
assert.match(source, /sort_options_desc: Boolean\(page\.sort_options_desc\)/, "page sort preference must be serialized");
assert.match(source, /action === "toggle-sort-desc"/, "page sort control must be handled");

console.log("PPT regeneration and page sort UI smoke passed.");
