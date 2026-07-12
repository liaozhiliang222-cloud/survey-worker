const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"]
};

const BAIYAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const BAIYAN_FALLBACK_MODELS = ["qwen-plus", "qwen-turbo", "qwen-max", "glm-4-plus", "glm-4-flash"];

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
  const host = url.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  const isPrivateHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (isLocalHost || isPrivateHost))) {
    throw new Error("Only HTTPS model APIs are allowed, except local/private model endpoints.");
  }
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    throw new Error("Only OpenAI-compatible /chat/completions APIs are supported.");
  }

  const allowedHosts = allowedHostsFromEnv(env);
  const presetHosts = PROVIDER_HOSTS[provider] || [];
  if (!isLocalHost && !isPrivateHost && !allowedHosts.has(host) && !presetHosts.includes(host)) {
    throw new Error(`Model API host is not allowed: ${host}`);
  }
  return url.toString();
}

function shouldRetryModel(errorText) {
  const msg = String(errorText || "").toLowerCase();
  return (
    msg.includes("insufficient") ||
    msg.includes("quota") ||
    msg.includes("rate_limit") ||
    msg.includes("limit") ||
    msg.includes("not found") ||
    msg.includes("not exist") ||
    msg.includes("invalid model") ||
    msg.includes("model.*not") ||
    msg.includes("不存在") ||
    msg.includes("不支持") ||
    msg.includes("无法识别") ||
    msg.includes("额度") ||
    msg.includes("限流") ||
    msg.includes("unavailable") ||
    msg.includes("deprecated") ||
    msg.includes("not supported") ||
    msg.includes("access denied") ||
    msg.includes("permission") ||
    msg.includes("no permission")
  );
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
    const requestBody = payload.body;
    let targetUrl, apiKey, isBuiltIn = false;

    const userApiKey = String(payload.apiKey || "").trim();

    if (!userApiKey) {
      // 用户未配置 API Key → 使用内置百炼 Key
      apiKey = env.BAIYAN_API_KEY;
      if (!apiKey) {
        return json({
          error: {
            message: "平台内置模型未配置，请先在 AI 设置中配置 API Key，或联系管理员。"
          }
        }, { status: 503 });
      }
      targetUrl = BAIYAN_URL;
      isBuiltIn = true;
    } else {
      // 用户配置了 API Key → 按原有逻辑
      targetUrl = validateTarget(provider, payload.url, env);
      apiKey = userApiKey;
    }

    if (!requestBody || !requestBody.model || !Array.isArray(requestBody.messages)) {
      return json({ error: { message: "Missing model or messages." } }, { status: 400 });
    }

    // 构建模型尝试列表
    // 内置百炼模式：百炼只支持 qwen/glm 系列模型
    // 如果前端发送的 model 是百炼支持的（qwen/glm 开头），先尝试它
    // 否则直接使用百炼回退模型列表
    const isBaiyanModel = (m) => /^(qwen|glm)/i.test(m);
    const modelsToTry = isBuiltIn
      ? [...new Set([
          ...(isBaiyanModel(requestBody.model) ? [requestBody.model] : []),
          ...BAIYAN_FALLBACK_MODELS
        ])]
      : [requestBody.model];

    let lastError = null;

    for (const model of modelsToTry) {
      const body = { ...requestBody, model };
      // 内置百炼模式：限制 max_tokens 不超过 8192（百炼模型输出上限）
      if (isBuiltIn && body.max_tokens && body.max_tokens > 8192) {
        body.max_tokens = 8192;
      }
      // 设置超时控制，防止大报告生成时524超时
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);
      let upstream;
      try {
        upstream = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const text = await upstream.text();

      if (upstream.ok && text.trim()) {
        // 尝试解析，确保返回有效内容
        try {
          const parsed = JSON.parse(text);
          const content = parsed?.choices?.[0]?.message?.content || parsed?.choices?.[0]?.text || parsed?.output_text || parsed?.content || "";
          if (content.trim()) {
            return new Response(text, {
              status: upstream.status,
              headers: {
                "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                "X-Actual-Model": model
              }
            });
          }
        } catch {
          // 解析失败但返回成功，仍然返回
        }
        return new Response(text, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "X-Actual-Model": model
          }
        });
      }

      // 检查是否可重试
      if (!shouldRetryModel(text)) {
        // 不可重试的错误，直接返回
        return new Response(text || JSON.stringify({ error: { message: "Upstream error." } }), {
          status: upstream.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          }
        });
      }

      lastError = text;
    }

    // 所有模型都失败了
    return json({
      error: {
        message: `所有内置模型均不可用，请稍后重试或配置自己的 API Key。错误: ${lastError || "未知错误"}`
      }
    }, { status: 502 });

  } catch (error) {
    let message = error.message || "AI proxy request failed.";
    if (error.name === "AbortError") {
      message = "模型响应超时（5分钟），可能因数据量过大。建议减少数据量后重试，或选择更快的模型档位。";
    }
    const status = /missing|only|not allowed|invalid/i.test(message) ? 400 : 500;
    return json({ error: { message } }, { status });
  }
}
