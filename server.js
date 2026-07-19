const http = require("http");
const fs = require("fs");
const path = require("path");
const { configuredBodyLimit } = require("./lib/request-body");
const { sendJson } = require("./lib/http-response");
const { createPptxProxyHandler } = require("./lib/pptx-proxy");
const { createAiProxyHandler } = require("./lib/ai-proxy");

const root = __dirname;
const port = Number(process.env.PORT || 4281);
const maxAiBodyBytes = configuredBodyLimit(process.env.AI_PROXY_MAX_BODY_BYTES, 1024 * 1024, 10 * 1024 * 1024);
const maxPptxBodyBytes = configuredBodyLimit(process.env.PPTX_PROXY_MAX_BODY_BYTES, 30 * 1024 * 1024, 100 * 1024 * 1024);
const pptxBackendUrl = String(process.env.PPTX_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const configuredPptxProxyTimeoutMs = Number(process.env.PPTX_PROXY_TIMEOUT_MS);
const pptxProxyTimeoutMs = Number.isFinite(configuredPptxProxyTimeoutMs)
  ? Math.min(300_000, Math.max(1_000, Math.round(configuredPptxProxyTimeoutMs)))
  : 120_000;

const handleAiProxy = createAiProxyHandler({
  env: process.env,
  maxBodyBytes: maxAiBodyBytes,
});
const handlePptxProxy = createPptxProxyHandler({
  backendUrl: pptxBackendUrl,
  timeoutMs: pptxProxyTimeoutMs,
  maxBodyBytes: maxPptxBodyBytes,
});
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

http
  .createServer((req, res) => {
    if (req.url === "/healthz" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "surveykit-web",
        pptx_backend_configured: Boolean(process.env.PPTX_BACKEND_URL)
      });
      return;
    }

    if (req.url.startsWith("/pptx-api")) {
      handlePptxProxy(req, res);
      return;
    }
    if (req.url === "/api/ai") {
      handleAiProxy(req, res);
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.resolve(root, `.${requestedPath}`);

    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(content);
    });
  })
  .listen(port, () => {
    console.log(`Research toolbox running at http://localhost:${port}`);
  });
