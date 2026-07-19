"use strict";

const { collectRequestBody, bodyLimitError } = require("./request-body");
const { sendJson } = require("./http-response");

function createPptxProxyHandler({ backendUrl, timeoutMs, maxBodyBytes }) {
  if (!backendUrl) throw new Error("PPTX backend URL is required.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("PPTX proxy timeout must be positive.");
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) throw new Error("PPTX body limit must be positive.");
  const normalizedBackend = String(backendUrl).replace(/\/+$/, "");

  return function handlePptxProxy(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const backendPath = requestUrl.pathname.endsWith("/healthz")
      ? "/healthz"
      : requestUrl.pathname.replace(/^\/pptx-api(?:\/|$)/, "/api/pptx-report/");
    const targetUrl = normalizedBackend + backendPath + requestUrl.search;

    collectRequestBody(req, maxBodyBytes, async ({ body, error, tooLarge }) => {
      if (error) {
        sendJson(res, 400, { error: { message: `读取 PPTX 请求失败：${error.message}` } });
        return;
      }
      if (tooLarge) {
        sendJson(res, 413, bodyLimitError("PPTX", maxBodyBytes));
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = { ...req.headers };
        delete headers.host;
        delete headers["content-length"];
        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
          signal: controller.signal,
        });
        const responseBody = Buffer.from(await upstream.arrayBuffer());
        const responseHeaders = Object.fromEntries(upstream.headers.entries());
        responseHeaders["access-control-allow-origin"] = "*";
        res.writeHead(upstream.status, responseHeaders);
        res.end(responseBody);
      } catch (error) {
        const message = error.name === "AbortError"
          ? `PPTX 后端响应超时（${Math.round(timeoutMs / 1000)}s）。`
          : `PPTX 后端连接失败：${error.message}`;
        sendJson(res, 502, { error: { message } });
      } finally {
        clearTimeout(timeout);
      }
    });
  };
}

module.exports = { createPptxProxyHandler };
