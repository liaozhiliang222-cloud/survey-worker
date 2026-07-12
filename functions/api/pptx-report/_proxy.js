// 共享代理逻辑：把 /api/pptx-report/* 请求转发到阿里云 ECS 上的 Python API。
// 浏览器只与 Cloudflare 同源通信，阿里云后端地址通过环境变量 PPTX_BACKEND_URL 配置，
// 不暴露公网 IP，也避免浏览器跨域问题。

const BACKEND_ENV = "PPTX_BACKEND_URL";
// 兜底默认值：阿里云 ECS 上的 FastAPI 服务（如需换机器改这里或设 Cloudflare 变量 PPTX_BACKEND_URL）
const BACKEND_DEFAULT = "http://8.138.201.60:8000";

export async function proxyToBackend(request, env) {
  // 处理 OPTIONS 预检请求（CORS）
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      }
    });
  }
  
  const backend = env[BACKEND_ENV] || BACKEND_DEFAULT;
  if (!backend) {
    return new Response(
      JSON.stringify({ error: { message: "PPTX 后端未配置（Cloudflare 变量缺少 PPTX_BACKEND_URL）。" } }),
      { 
        status: 500, 
        headers: { 
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        }
      }
    );
  }

  const url = new URL(request.url);
  const target = backend.replace(/\/+$/, "") + url.pathname + url.search;

  // 转发请求头，但去掉 host/content-length（由运行时重新计算）
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timeout);
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
    return new Response(
      JSON.stringify({ error: { message: msg } }),
      { 
        status: 502, 
        headers: { 
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        } 
      }
    );
  }
}
