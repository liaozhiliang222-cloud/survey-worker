// 共享代理逻辑：把 /api/pptx-report/* 请求转发到阿里云 ECS 上的 Python API。
// 浏览器只与 Cloudflare 同源通信，阿里云后端地址通过环境变量 PPTX_BACKEND_URL 配置，
// 不暴露公网 IP，也避免浏览器跨域问题。

const BACKEND_ENV = "PPTX_BACKEND_URL";
// 兜底默认值：首尔节点的阿里云后端域名（Nginx HTTP 端口 80）。
// 使用域名可让 Nginx 正确命中对应的 server_name，避免以 IP 访问时落入默认站点。
// 如需换机器或端口，修改此处或在 Cloudflare Pages 变量 PPTX_BACKEND_URL 中配置。
const BACKEND_DEFAULT = "http://ppt-api.surveykit.cc";
const LEGACY_BACKENDS = ["8.138.201.60", "api.surveykit.cc", "47.80.25.112"];

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function resolveBackend(env) {
  const fromEnv = env && typeof env[BACKEND_ENV] === "string" ? env[BACKEND_ENV].trim() : "";
  const configured = fromEnv.replace(/\/+$/, "");
  if (
    !configured ||
    configured.includes("ppt-api.surveykit.cc") ||
    LEGACY_BACKENDS.some((legacy) => configured.includes(legacy))
  ) {
    return BACKEND_DEFAULT;
  }
  return configured;
}

function buildForwardHeaders(request) {
  const blocked = new Set([
    "host",
    "origin",
    "referer",
    "content-length",
    "accept-encoding",
    "connection",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!blocked.has(lower) && !lower.startsWith("cf-")) {
      headers.set(key, value);
    }
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
  } catch (_) {
    if (text) message = text.slice(0, 400);
  }
  if (upstream.status === 403) {
    message = "PPTX 后端返回 403。请检查首尔后端服务和 Cloudflare Pages 的 PPTX_BACKEND_URL 配置。";
  }
  return jsonResponse(
    {
      error: {
        message,
        status: upstream.status,
      },
    },
    upstream.status,
  );
}

export async function proxyToBackend(request, env) {
  // 处理 OPTIONS 预检请求（CORS）
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      }
    });
  }
  
  const backend = resolveBackend(env);
  if (!backend) {
    return jsonResponse({ error: { message: "PPTX 后端未配置（Cloudflare 变量缺少 PPTX_BACKEND_URL）。" } }, 500);
  }

  const url = new URL(request.url);
  // 路径映射：前端用 /pptx-api/* 绕过 CF /api/ 拦截，转发时还原为后端实际路径 /api/pptx-report/*
  const backendPath = url.pathname.endsWith("/healthz")
    ? "/healthz"
    : url.pathname.replace(/^\/pptx-api(?:\/|$)/, "/api/pptx-report/");
  const target = backend.replace(/\/+$/, "") + backendPath + url.search;

  const headers = buildForwardHeaders(request);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half",
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timeout);
    if (!upstream.ok) {
      return upstreamError(upstream);
    }
    // 透传上游响应（含 .pptx 二进制流与 Content-Disposition）
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...Object.fromEntries(upstream.headers.entries()),
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e.name === "AbortError"
        ? "后端响应超时（120s），报告可能过大或后端不可用。"
        : "代理到 PPTX 后端失败：" + (e.message || String(e));
    return jsonResponse({ error: { message: msg } }, 502);
  }
}
