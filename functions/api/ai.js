const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"],
};

const MAX_BODY_BYTES = 1024 * 1024;
const BUILTIN_BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_BUILTIN_MODELS = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "glm-5.2",
  "kimi-k2.6",
  "qwen3.6-plus",
  "qwen3-max",
  "deepseek-v3.2",
  "glm-5.1",
  "qwen3.5-plus",
];

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
  const configuredModels = String(env?.BAILIAN_MODELS || env?.BAILIAN_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    apiKey: String(env?.DASHSCOPE_API_KEY || env?.BAILIAN_API_KEY || env?.AI_API_KEY || "").trim(),
    models: configuredModels.length ? configuredModels : DEFAULT_BUILTIN_MODELS,
    url: String(env?.BAILIAN_API_URL || BUILTIN_BAILIAN_URL).trim(),
  };
}

function extractAssistantContent(text) {
  try {
    const payload = JSON.parse(text);
    return String(
      payload?.choices?.[0]?.message?.content
      || payload?.choices?.[0]?.message?.reasoning_content
      || payload?.choices?.[0]?.text
      || "",
    ).trim();
  } catch {
    return "";
  }
}

function containsJsonObject(text) {
  const content = extractAssistantContent(text);
  const candidate = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
    || content.match(/\{[\s\S]*\}/)?.[0]
    || content;
  if (!candidate) return false;
  try {
    const parsed = JSON.parse(candidate.replace(/^\uFEFF/, "").trim());
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function prepareBuiltinBody(body, model) {
  const next = { ...body, model };
  // 百炼当前的 DeepSeek V4 不支持 response_format；保留提示词并在代理层验证 JSON，
  // 若输出不合规会自动切换到支持结构化输出的后备模型。
  if (/^deepseek-/i.test(model)) delete next.response_format;
  return next;
}

async function callUpstream(targetUrl, apiKey, body, timeoutMs = 240_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (body.stream && upstream.ok) return { upstream, text: "", stream: true };
    return { upstream, text: await upstream.text(), stream: false };
  } finally {
    clearTimeout(timeout);
  }
}
function upstreamResponse(text, upstream, model, source, attempts = []) {
  return new Response(text || upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Actual-Model": upstream.headers.get("X-Actual-Model") || model,
      "X-AI-Source": source,
      "X-AI-Attempts": attempts.join(","),
    },
  });
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

    if (!useBuiltin) {
      const targetUrl = validateTarget(payload.provider || "custom", payload.url);
      const { upstream, text } = await callUpstream(targetUrl, apiKey, body, 540_000);
      if (body.stream && upstream.ok) return upstreamResponse("", upstream, body.model, "user-key", [body.model]);
      if (!text.trim()) return json({ error: { message: "模型返回为空，请检查模型名称、额度或服务状态。" } }, 502);
      return upstreamResponse(text, upstream, body.model, "user-key", [body.model]);
    }

    const targetUrl = validateTarget("qwen", builtin.url);
    const wantsJson = body.response_format?.type === "json_object";
    const attempts = [];
    let lastResult = null;
    let lastError = null;
    for (const model of builtin.models) {
      attempts.push(model);
      const upstreamBody = prepareBuiltinBody(body, model);
      let result;
      try {
        result = await callUpstream(targetUrl, apiKey, upstreamBody);
      } catch (error) {
        lastError = error;
        continue;
      }
      lastResult = { ...result, model };
      if (result.stream) return upstreamResponse("", result.upstream, model, "builtin-bailian", attempts);
      if (!result.upstream.ok || !result.text.trim()) continue;
      if (wantsJson && !containsJsonObject(result.text)) continue;
      return upstreamResponse(result.text, result.upstream, model, "builtin-bailian", attempts);
    }
    if (!lastResult?.text?.trim()) {
      const reason = lastError?.name === "AbortError" ? "模型响应超时" : (lastError?.message || "未返回有效内容");
      return json({ error: { message: `内置模型均未返回有效内容：${reason}，请稍后重试。` } }, 502);
    }
    return upstreamResponse(lastResult.text, lastResult.upstream, lastResult.model, "builtin-bailian", attempts);
  } catch (error) {
    return json({ error: { message: error.message || "AI 代理调用失败。" } }, 400);
  }
}
