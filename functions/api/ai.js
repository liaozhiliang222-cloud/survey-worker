const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"],
};

const MAX_BODY_BYTES = 1024 * 1024;
const BUILTIN_QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const BUILTIN_QWEN_MODEL = "qwen-plus";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

function validateTarget(provider, rawUrl) {
  if (!rawUrl) throw new Error("缺少模型接口地址。");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("模型接口必须使用 HTTPS。");
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    throw new Error("仅支持 OpenAI 兼容的 /chat/completions 接口。");
  }
  const allowed = new Set(Object.values(PROVIDER_HOSTS).flat());
  if (!allowed.has(url.hostname.toLowerCase())) {
    throw new Error(`不允许访问模型域名：${url.hostname}`);
  }
  if (provider && PROVIDER_HOSTS[provider] && !PROVIDER_HOSTS[provider].includes(url.hostname.toLowerCase())) {
    throw new Error("模型供应商与接口域名不匹配。");
  }
  return url.toString();
}

function getBuiltinConfig(env) {
  return {
    apiKey: String(env?.DASHSCOPE_API_KEY || env?.BAILIAN_API_KEY || env?.AI_API_KEY || "").trim(),
    model: String(env?.BAILIAN_MODEL || BUILTIN_QWEN_MODEL).trim(),
    url: String(env?.BAILIAN_API_URL || BUILTIN_QWEN_URL).trim(),
  };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);

  const contentLength = Number(request.headers.get("Content-Length")) || 0;
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: { message: "AI 请求内容过大。" } }, 413);
  }

  try {
    const payload = await request.json();
    const body = payload.body;
    if (!body?.model || !Array.isArray(body.messages)) {
      return json({ error: { message: "模型或消息内容不完整。" } }, 400);
    }

    const clientApiKey = String(payload.apiKey || "").trim();
    const builtin = getBuiltinConfig(env);
    const useBuiltin = !clientApiKey;
    const apiKey = useBuiltin ? builtin.apiKey : clientApiKey;
    if (!apiKey) {
      return json({ error: { message: "平台内置百炼服务尚未完成配置，请联系管理员。" } }, 503);
    }

    const targetUrl = useBuiltin
      ? validateTarget("qwen", builtin.url)
      : validateTarget(payload.provider || "custom", payload.url);
    const upstreamBody = useBuiltin ? { ...body, model: builtin.model } : body;
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
    const text = await upstream.text();
    if (!text.trim()) {
      return json({ error: { message: "模型返回为空，请检查模型名称、额度或服务状态。" } }, 502);
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "X-Actual-Model": upstream.headers.get("X-Actual-Model") || upstreamBody.model,
        "X-AI-Source": useBuiltin ? "builtin-bailian" : "user-key",
      },
    });
  } catch (error) {
    return json({ error: { message: error.message || "AI 代理调用失败。" } }, 400);
  }
}
