const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"]
};

const MAX_BODY_BYTES = 1024 * 1024;

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...(init.headers || {})
    }
  });
}

function allowedHostsFromEnv(env) {
  const extra = (env?.AI_PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...Object.values(PROVIDER_HOSTS).flat(), ...extra]);
}

function validateTarget(provider, rawUrl, env) {
  if (!rawUrl) throw new Error("Missing provider API URL.");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Only HTTPS model APIs are allowed.");
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    throw new Error("Only OpenAI-compatible /chat/completions APIs are supported.");
  }

  const host = url.hostname.toLowerCase();
  const allowedHosts = allowedHostsFromEnv(env);
  const presetHosts = PROVIDER_HOSTS[provider] || [];
  if (!allowedHosts.has(host) && !presetHosts.includes(host)) {
    throw new Error(`Model API host is not allowed: ${host}`);
  }
  return url.toString();
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: { message: "Request body is too large." } }, { status: 413 });
    }

    const payload = await request.json();
    const provider = payload.provider || "custom";
    const targetUrl = validateTarget(provider, payload.url, env);
    const apiKey = String(payload.apiKey || "").trim();
    const requestBody = payload.body;

    if (!apiKey || !requestBody || !requestBody.model || !Array.isArray(requestBody.messages)) {
      return json({ error: { message: "Missing apiKey, model or messages." } }, { status: 400 });
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const text = await upstream.text();
    if (!text.trim()) {
      return json({
        error: {
          message: `Upstream returned empty response from ${new URL(targetUrl).hostname}. Please check model name, API key, account quota or provider status.`
        }
      }, { status: upstream.ok ? 502 : upstream.status });
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error.message || "AI proxy request failed.";
    const status = /missing|only|not allowed|invalid/i.test(message) ? 400 : 500;
    return json({ error: { message } }, { status });
  }
}
