const CACHE_NAME = "research-toolbox-v47";
const ASSETS = [
  "./manifest.webmanifest",
  "./icon.svg",
  "./cloudflare-pages-verification.txt"
];

function isAppShellRequest(request) {
  const url = new URL(request.url);
  if (request.mode === "navigate") return true;
  return ["/", "/index.html", "/app.js", "/proposal-deck.js", "/styles.css", "/sw.js"].some((path) => url.pathname.endsWith(path));
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // PPTX 任务进度与下载地址是动态接口，绝不能进入离线缓存。
  // 否则轮询会反复命中第一次响应（例如一直显示 12%）。
  if (/^\/pptx-api(?:\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
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
