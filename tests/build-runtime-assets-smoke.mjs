import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const built = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { cwd: root, encoding: "utf8", windowsHide: true });
assert.equal(built.status, 0, built.stderr);
// Classic scripts are copied, not transformed by Vite. Their literal imports
// must exist at the exact source URL in the deployable build, including on refresh.
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let count = 0;
for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
  if (/type=["']module["']/.test(tag[0])) continue;
  const src = tag[0].match(/src=["']\.\/([^"'?]+)/)?.[1];
  if (!src) continue;
  const code = fs.readFileSync(path.join(root, src), "utf8");
  for (const match of code.matchAll(/import\(["'](\.\/[^"']+)["']\)/g)) {
    const relative = path.join(path.dirname(src), match[1].split("?")[0]);
    const output = path.join(root, "dist", relative);
    assert.ok(fs.existsSync(output), `Missing runtime module in production build: ${relative}`);
    assert.equal(fs.readFileSync(output, "utf8"), fs.readFileSync(path.join(root, relative), "utf8"));
    count++;
  }
}
assert.ok(count >= 2, "Expected classic app export and parser imports");
console.log(`Production build runtime modules passed: ${count} imports retain their exact URLs`);
