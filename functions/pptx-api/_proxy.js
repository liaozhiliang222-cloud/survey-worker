// Cloudflare Pages proxy for the Python PPTX report service.
const BACKEND_ENV = "PPTX_BACKEND_URL";
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function isPrivateHttpHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local")) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function resolveBackend(env) {
  const raw = env && typeof env[BACKEND_ENV] === "string" ? env[BACKEND_ENV].trim() : "";
  if (!raw) return "";
  const url = new URL(raw);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("only HTTP or HTTPS backend URLs are allowed");
  }
  if (url.search || url.hash) {
    throw new Error("query strings and fragments are not allowed in the backend URL");
  }
  if (url.protocol === "http:" && !isPrivateHttpHost(url.hostname)) {
    url.protocol = "https:";
  }
  return url.toString().replace(/\/+$/, "");
}

function proxyTimeoutMs(env) {
  const configured = Number(env?.PPTX_PROXY_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(configured)));
}

function buildForwardHeaders(request) {
  const blocked = new Set([
    "host", "origin", "referer", "content-length", "accept-encoding", "connection",
    "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
    "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  ]);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!blocked.has(lower) && !lower.startsWith("cf-")) headers.set(key, value);
  });
  const url = new URL(request.url);
  headers.set("X-SurveyKit-Proxy", "cloudflare-pages");
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  return headers;
}

async function upstreamError(upstream) {
  const text = await upstream.text().catch(() => "");
  let message = `PPTX 后端返回 ${upstream.status}`;
  try {
    const data = JSON.parse(text);
    message = data?.error?.message || data?.message || message;
  } catch {
    if (text) message = text.slice(0, 400);
  }
  let responseStatus = upstream.status;
  if (upstream.status >= 300 && upstream.status < 400) {
    responseStatus = 502;
    message = "PPTX 后端地址仍发生重定向。请将 PPTX_BACKEND_URL 配置为最终 HTTPS 地址。";
  } else if (upstream.status === 403) {
    message = "PPTX 后端拒绝访问。请检查后端访问策略和 PPTX_BACKEND_URL 配置。";
  }
  return jsonResponse({ error: { message, status: upstream.status } }, responseStatus);
}

function proxyReleaseInfo(env = {}) {
  return {
    version: String(env.SURVEYKIT_RELEASE || env.CF_PAGES_COMMIT_SHA || "unknown"),
    revision: String(env.SURVEYKIT_COMMIT || env.CF_PAGES_COMMIT_SHA || ""),
    deployed_at: String(env.SURVEYKIT_DEPLOYED_AT || ""),
  };
}

export async function proxyToBackend(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Project-Id, X-SurveyKit-Client-ID",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  let backend;
  try {
    backend = resolveBackend(env);
  } catch (error) {
    return jsonResponse({ error: { message: `PPTX_BACKEND_URL 配置无效：${error.message}` } }, 500);
  }
  if (!backend) {
    return jsonResponse({ error: { message: "PPTX 后端未配置（缺少 PPTX_BACKEND_URL）。" } }, 503);
  }

  const url = new URL(request.url);
  const backendPath = url.pathname.endsWith("/healthz")
    ? "/healthz"
    : url.pathname.replace(/^\/pptx-api(?:\/|$)/, "/api/pptx-report/");
  const target = backend + backendPath + url.search;
  const timeoutMs = proxyTimeoutMs(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half",
      signal: controller.signal,
      redirect: "manual",
    });
    if (!upstream.ok) return upstreamError(upstream);
    if (backendPath === "/healthz") {
      const backendHealth = await upstream.json().catch(() => null);
      if (!backendHealth || typeof backendHealth !== "object") {
        return jsonResponse({ error: { message: "PPTX 后端健康响应不是有效 JSON。" } }, 502);
      }
      return jsonResponse({
        ...backendHealth,
        proxy: {
          ok: true,
          service: "surveykit-pptx-proxy",
          release: proxyReleaseInfo(env),
          backend_protocol: new URL(backend).protocol.replace(":", ""),
        },
      }, 200, {
        "X-SurveyKit-Service": "surveykit-pptx-proxy",
        "X-SurveyKit-Release": proxyReleaseInfo(env).version,
      });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...Object.fromEntries(upstream.headers.entries()),
        "Access-Control-Allow-Origin": "*",
        "X-SurveyKit-Service": "surveykit-pptx-proxy",
        "X-SurveyKit-Release": proxyReleaseInfo(env).version,
      },
    });
  } catch (error) {
    const message = error.name === "AbortError"
      ? `后端响应超时（${Math.round(timeoutMs / 1000)}s），报告可能过大或后端不可用。`
      : "代理到 PPTX 后端失败：" + (error.message || String(error));
    return jsonResponse({ error: { message } }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export { resolveBackend };
