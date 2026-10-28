const CACHE_NAME = "research-toolbox-v106";
// 内容哈希资源：URL 随内容变化，可安全缓存优先。名称不以 research-toolbox- 开头，版本升级时不被整体清空。
const IMMUTABLE_CACHE = "surveykit-immutable-v1";
const ASSETS = [
  "./manifest.webmanifest",
  "./icon.svg",
  "./cloudflare-pages-verification.txt",
  "./templates/crosstab/crosstab-header-template.xlsx",
  "./templates/research-models/psm-template.xlsx",
  "./templates/research-models/kano-template.xlsx",
  "./templates/research-models/maxdiff-template.xlsx",
  "./templates/research-models/driver-template.xlsx",
  "./templates/research-models/turf-template.xlsx",
  "./templates/research-models/conjoint-template.xlsx"
];

// 只认构建生成的两种格式：经典脚本 ?v=h + 12 位 sha256，以及 Vite 的 /assets/name-8位哈希.js|css。
// 手写版本号（如 ?v=20261017-1）仍走网络优先，避免版本号漏改时返回旧代码。
function isImmutableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (/^h[0-9a-f]{12}$/.test(url.searchParams.get("v") || "")) return true;
  return /^\/assets\/[\w.-]+-[\w-]{8}\.(?:js|css)$/.test(url.pathname);
}

function immutableAssetIdentity(href) {
  const url = new URL(href);
  return url.pathname.startsWith("/assets/") ? url.pathname.replace(/-[\w-]{8}(\.(?:js|css))$/, "$1") : url.pathname;
}

// 写入新版本后删除同一文件的旧版本，缓存只保留每个文件的最新一份。
function pruneImmutableAssets(cache, href) {
  const identity = immutableAssetIdentity(href);
  return cache.keys().then((keys) => Promise.all(keys
    .filter((key) => key.url !== href && immutableAssetIdentity(key.url) === identity)
    .map((key) => cache.delete(key))));
}

function cacheFirstImmutable(request) {
  return caches.open(IMMUTABLE_CACHE).then((cache) => cache.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response && response.status === 200 && response.type === "basic") {
      const clone = response.clone();
      cache.put(request, clone).then(() => pruneImmutableAssets(cache, request.url)).catch(() => {});
    }
    return response;
  })));
}

function isAppShellRequest(request) {
  const url = new URL(request.url);
  if (request.mode === "navigate") return true;
  if (/\/questionnaire-(quality|delivery|workflow|review-ui)\.js$/.test(url.pathname)) return true;
  if (/\/driver-(core|analysis-ui|lmg|lmg-ui|lmg-worker)\.js$/.test(url.pathname)) return true;
  if (url.pathname.startsWith("/src/") || url.pathname.startsWith("/assets/")) return true;
  return ["/", "/index.html", "/app.js", "/ppt-report-ai.js", "/proposal-deck.js", "/cluster-analysis.js", "/crosstab-models.js", "/crosstab-net.js", "/crosstab-model-ui.js", "/indicator-weighting.js", "/indicator-weighting-ui.js", "/cluster-core.js", "/cluster-worker.js", "/styles.css", "/sw.js"].some((path) => url.pathname.endsWith(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("research-toolbox-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (/^\/api\/ai(?:\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  if (/^\/api\/research(?:\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  if (event.request.method !== "GET") return;
  // PPTX 任务进度与下载地址是动态接口，绝不能进入离线缓存。
  // 否则轮询会反复命中第一次响应（例如一直显示 12%）。
  if (/^\/pptx-api(?:\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirstImmutable(event.request));
    return;
  }

  if (isAppShellRequest(event.request)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => response)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (!response || response.status !== 200 || response.type !== "basic") return response;
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      return response;
    }))
  );
});
