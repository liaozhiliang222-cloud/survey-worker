import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

// 1. 缓存优先只认构建生成的内容哈希格式；手写版本号与动态接口仍走网络。
{
  const start = sw.indexOf("function isImmutableAsset("), end = sw.indexOf("function immutableAssetIdentity(");
  const isImmutable = new Function("self", `${sw.slice(start, end)}; return isImmutableAsset;`)({ location: { origin: "https://surveykit.cc" } });
  const check = (href) => isImmutable(new URL(href));
  assert.equal(check("https://surveykit.cc/app.js?v=h94b65749c90c"), true);
  assert.equal(check("https://surveykit.cc/assets/index-BIgYDxCi.js"), true);
  assert.equal(check("https://surveykit.cc/assets/manifest-Bt-3i9i3.css"), true);
  assert.equal(check("https://surveykit.cc/cluster-core.js?v=old"), false);
  assert.equal(check("https://surveykit.cc/app.js?v=20261017-all11-1"), false);
  assert.equal(check("https://surveykit.cc/assets/icon.svg"), false);
  assert.equal(check("https://surveykit.cc/api/research/projects?v=h94b65749c90c"), true, "API 由更早的分支处理，见下方顺序断言");
  assert.equal(check("https://other.example/app.js?v=h94b65749c90c"), false);
  const fetchHandler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
  for (const api of ["/api\\/ai", "/api\\/research", "/pptx-api"]) assert.ok(fetchHandler.indexOf(api) < fetchHandler.indexOf("isImmutableAsset(url)"), `${api} 必须先于缓存优先分支`);
  const identityStart = sw.indexOf("function immutableAssetIdentity(");
  const identity = new Function("URL", `${sw.slice(identityStart, sw.indexOf("// 写入新版本", identityStart))}; return immutableAssetIdentity;`)(URL);
  assert.equal(identity("https://surveykit.cc/assets/index-BIgYDxCi.js"), identity("https://surveykit.cc/assets/index-Zz_9-aB1.js"));
  assert.notEqual(identity("https://surveykit.cc/questionnaire-quality.js?v=h1"), identity("https://surveykit.cc/questionnaire-delivery.js?v=h2"));
}

// 2. 构建后每个经典脚本的版本号等于其内容哈希。
const build = (cwd) => spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { cwd, encoding: "utf8", windowsHide: true });
const built = build(root);
assert.equal(built.status, 0, built.stderr);
const contentVersion = (file) => `h${createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12)}`;
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const classic = [...html.matchAll(/<script\b[^>]*\bsrc="\.\/([^"?]+)\?v=([^"]+)"/g)];
assert.ok(classic.length >= 15, `expected classic scripts, got ${classic.length}`);
for (const [, file, version] of classic) assert.equal(version, contentVersion(path.join(root, file)), file);
assert.match(html, /src="\/assets\/index-[\w-]{8}\.js"/);
assert.match(html, /<meta name="description" content="SurveyKit 调研工具箱：[^"]+"/);

// 3. 真实 Chrome：每个请求加 300ms 延迟，第二次打开时脚本应全部来自 Service Worker 缓存。
const DELAY_MS = 300;
const types = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const hits = [];
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  hits.push(req.url);
  setTimeout(() => {
    if (pathname.startsWith("/api/")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end("{}"); return; }
    const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  }, DELAY_MS);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.CI ? {} : { channel: "chrome" });
try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
  await page.reload({ waitUntil: "load" }); // 第一次受控加载：把哈希资源写入缓存
  await page.waitForFunction(async () => (await (await caches.open("surveykit-immutable-v1")).keys()).length >= 15, null, { timeout: 15000 });
  // 用新标签页模拟真实回访：reload 会复用渲染进程的内存缓存，测不出 Service Worker 的行为。
  await page.close();
  const revisit = await context.newPage();
  const pageErrors = [];
  revisit.on("pageerror", (error) => pageErrors.push(error.message));
  await revisit.goto("about:blank");
  hits.length = 0;
  await revisit.goto(base, { waitUntil: "load" });
  const dcl = await revisit.evaluate(() => Math.round(performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd));
  // sw.js 是浏览器的更新检查，必须走网络。
  const scriptHits = hits.filter((url) => /\.(?:js|css)(?:\?|$)/.test(url) && !url.startsWith("/sw.js"));
  assert.deepEqual(scriptHits, [], `repeat visit should not hit the network for hashed scripts: ${scriptHits.join(", ")}`);
  assert.ok(await revisit.evaluate(() => document.querySelector("#overview") !== null));
  assert.deepEqual(pageErrors, [], "cached scripts must run without errors");

  // 地址栏 #页面：已知页面可切换并支持后退，未知页面回到总览并提示。
  const activeView = () => revisit.evaluate(() => document.querySelector(".view.active")?.id);
  await revisit.evaluate(() => { location.hash = "crosstab"; });
  await revisit.waitForFunction(() => document.querySelector(".view.active")?.id === "crosstab-analysis");
  await revisit.evaluate(() => { location.hash = "ai-plan"; });
  await revisit.waitForFunction(() => document.querySelector(".view.active")?.id === "ai-plan");
  await revisit.goBack();
  await revisit.waitForFunction(() => document.querySelector(".view.active")?.id === "crosstab-analysis");
  await revisit.evaluate(() => { location.hash = "no-such-page"; });
  await revisit.waitForFunction(() => document.querySelector(".view.active")?.id === "overview");
  assert.match(await revisit.locator("#toastContainer").innerText(), /没有找到页面“#no-such-page”/);
  assert.equal(await activeView(), "overview");
  assert.match(await revisit.title(), /· SurveyKit 调研工具箱$/);

  // 手机宽度：导航抽屉为竖向分组，菜单项不再被挤成逐字竖排的窄条。
  await revisit.setViewportSize({ width: 375, height: 812 });
  await revisit.click(".mobile-menu-btn");
  await revisit.waitForFunction(() => document.querySelector(".sidebar")?.classList.contains("open"));
  const drawer = await revisit.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const item = sidebar.querySelector('.nav-item[data-view="sample"]').getBoundingClientRect();
    return { overflow: sidebar.scrollWidth - sidebar.clientWidth, itemWidth: item.width, itemHeight: item.height, phases: [...sidebar.querySelectorAll(".nav-phase")].filter((el) => el.offsetParent).length };
  });
  assert.ok(drawer.overflow <= 0, `drawer overflows by ${drawer.overflow}px`);
  assert.ok(drawer.itemWidth >= 180 && drawer.itemHeight >= 44, `drawer item ${drawer.itemWidth}x${drawer.itemHeight}`);
  assert.ok(drawer.phases >= 3, "drawer shows stage group titles");
  console.log(`first-load cache: repeat visit ${hits.length} network request(s), DOMContentLoaded ${dcl}ms with ${DELAY_MS}ms/request latency`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("first-load-cache-smoke: PASS");
