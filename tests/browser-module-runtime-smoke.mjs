import assert from "node:assert/strict";
import fs from "node:fs/promises";

const main = await fs.readFile(new URL("../src/main.js", import.meta.url), "utf8");
const app = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");
const index = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = await fs.readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.doesNotMatch(main, /import\s+["'][^"']+\.css["']/);
assert.match(main, /window\.SurveyKitFileParser\s*=\s*fileParserModule/);
assert.match(app, /import\("\.\/src\/shared\/file-parser\.js\?v=/);
assert.match(index, /src="\/src\/main\.js\?v=/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/src\/"\)/);

console.log("Browser module runtime smoke passed: parser bridge is source-hosting compatible");
