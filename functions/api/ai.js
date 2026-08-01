const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  sensenova: ["token.sensenova.cn", "api.sensenova.cn"],
  surveykit_gateway: ["api.surveykit.cc"],
  openai: ["api.openai.com"],
};

const MAX_BODY_BYTES = 1024 * 1024;
const BUILTIN_BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const BUILTIN_SENSENOVA_URL = "https://token.sensenova.cn/v1/chat/completions";
const BUILTIN_SURVEYKIT_GATEWAY_URL = "http://api.surveykit.cc/v1/chat/completions";
const DEFAULT_SENSENOVA_MODELS = ["deepseek-v4-flash"];
const DEFAULT_SURVEYKIT_GATEWAY_MODELS = ["deepseek-v4-flash"];
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

function validateTarget(provider, rawUrl, allowInsecureBuiltin = false) {
  if (!rawUrl) throw new Error("缺少模型接口地址。");
  const url = new URL(rawUrl);
  const isSurveykitGateway = allowInsecureBuiltin && provider === "surveykit_gateway"
    && url.protocol === "http:"
    && url.hostname.toLowerCase() === "api.surveykit.cc";
  if (url.protocol !== "https:" && !isSurveykitGateway) throw new Error("模型接口必须使用 HTTPS。");
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

function configuredModels(env, pluralKey, singularKey, defaults) {
  const configured = String(env?.[pluralKey] || env?.[singularKey] || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : defaults;
}

function getBuiltinConfigs(env) {
  const configs = [];
  const surveykitGatewayKey = String(env?.SURVEYKIT_GATEWAY_API_KEY || "").trim();
  if (surveykitGatewayKey) {
    configs.push({
      apiKey: surveykitGatewayKey,
      models: configuredModels(
        env,
        "SURVEYKIT_GATEWAY_MODELS",
        "SURVEYKIT_GATEWAY_MODEL",
        DEFAULT_SURVEYKIT_GATEWAY_MODELS,
      ),
      url: String(env?.SURVEYKIT_GATEWAY_API_URL || BUILTIN_SURVEYKIT_GATEWAY_URL).trim(),
      provider: "surveykit_gateway",
      source: "builtin-surveykit-gateway",
      timeoutMs: 90_000,
      attemptsPerModel: 3,
    });
  }

  const sensenovaKey = String(env?.SENSENOVA_API_KEY || "").trim();
  if (sensenovaKey) {
    configs.push({
      apiKey: sensenovaKey,
      models: configuredModels(env, "SENSENOVA_MODELS", "SENSENOVA_MODEL", DEFAULT_SENSENOVA_MODELS),
      url: String(env?.SENSENOVA_API_URL || BUILTIN_SENSENOVA_URL).trim(),
      provider: "sensenova",
      source: "builtin-sensenova",
      timeoutMs: 90_000,
      attemptsPerModel: 1,
    });
  }

  const bailianKey = String(
    env?.DASHSCOPE_API_KEY || env?.BAILIAN_API_KEY || env?.AI_API_KEY || "",
  ).trim();
  if (bailianKey) {
    configs.push({
      apiKey: bailianKey,
      models: configuredModels(env, "BAILIAN_MODELS", "BAILIAN_MODEL", DEFAULT_BUILTIN_MODELS),
      url: String(env?.BAILIAN_API_URL || BUILTIN_BAILIAN_URL).trim(),
      provider: "qwen",
      source: "builtin-bailian",
      timeoutMs: 240_000,
      attemptsPerModel: 1,
    });
  }
  return configs;
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

function containsUpstreamError(text) {
  try {
    return Boolean(JSON.parse(text)?.error);
  } catch {
    return false;
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
    const useBuiltin = !clientApiKey;
    const builtins = useBuiltin ? getBuiltinConfigs(env) : [];
    if (useBuiltin && !builtins.length) {
      return json({ error: { message: "\u5e73\u53f0\u5185\u7f6e AI \u670d\u52a1\u5c1a\u672a\u5b8c\u6210\u914d\u7f6e\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002" } }, 503);
    }

    if (!useBuiltin) {
      const targetUrl = validateTarget(payload.provider || "custom", payload.url);
      const { upstream, text } = await callUpstream(targetUrl, clientApiKey, body, 280_000);
      if (body.stream && upstream.ok) return upstreamResponse("", upstream, body.model, "user-key", [body.model]);
      if (!text.trim()) return json({ error: { message: "\u6a21\u578b\u8fd4\u56de\u4e3a\u7a7a\uff0c\u8bf7\u68c0\u67e5\u6a21\u578b\u540d\u79f0\u3001\u989d\u5ea6\u6216\u670d\u52a1\u72b6\u6001\u3002" } }, 502);
      return upstreamResponse(text, upstream, body.model, "user-key", [body.model]);
    }

    const wantsJson = body.response_format?.type === "json_object";
    const attempts = [];
    let lastResult = null;
    let lastError = null;
    for (const builtin of builtins) {
      const targetUrl = validateTarget(builtin.provider, builtin.url, true);
      for (const model of builtin.models) {
        const attemptCount = Math.max(1, Number(builtin.attemptsPerModel) || 1);
        for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
          attempts.push(model);
          const upstreamBody = prepareBuiltinBody(body, model);
          let result;
          try {
            result = await callUpstream(targetUrl, builtin.apiKey, upstreamBody, builtin.timeoutMs);
          } catch (error) {
            lastError = error;
            continue;
          }
          lastResult = { ...result, model, builtin };
          if (result.stream) {
            return upstreamResponse("", result.upstream, model, builtin.source, attempts);
          }
          if (!result.upstream.ok || !result.text.trim() || containsUpstreamError(result.text)) continue;
          if (wantsJson && !containsJsonObject(result.text)) continue;
          return upstreamResponse(result.text, result.upstream, model, builtin.source, attempts);
        }
      }
    }
    const jsonInvalid = wantsJson
      && lastResult?.upstream?.ok
      && !lastResult?.stream
      && !containsJsonObject(lastResult.text || "");
    if (jsonInvalid || !lastResult?.text?.trim()) {
      const reason = jsonInvalid
        ? "\u6240\u6709\u5185\u7f6e\u6a21\u578b\u5747\u672a\u8fd4\u56de\u6709\u6548\u7684 JSON"
        : (lastError?.name === "AbortError"
          ? "\u6a21\u578b\u54cd\u5e94\u8d85\u65f6"
          : (lastError?.message || "\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9"));
      return json({ error: { message: `\u6240\u6709\u5185\u7f6e AI \u670d\u52a1\u5747\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9\uff1a${reason}\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002` } }, 502);
    }
    return upstreamResponse(
      lastResult.text,
      lastResult.upstream,
      lastResult.model,
      lastResult.builtin.source,
      attempts,
    );
  } catch (error) {
    return json({ error: { message: error.message || "AI 代理调用失败。" } }, 400);
  }
}
