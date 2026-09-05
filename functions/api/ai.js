const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  sensenova: ["token.sensenova.cn", "api.sensenova.cn"],
  surveykit_gateway: ["api.surveykit.cc"],
  volcengine_agent_plan: ["ark.cn-beijing.volces.com"],
  openai: ["api.openai.com"],
};

const MAX_BODY_BYTES = 1024 * 1024;
const BUILTIN_VOLCENGINE_AGENT_PLAN_URL = "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions";
const BUILTIN_BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const BUILTIN_SENSENOVA_URL = "https://token.sensenova.cn/v1/chat/completions";
const BUILTIN_SURVEYKIT_GATEWAY_URL = "http://api.surveykit.cc/v1/chat/completions";
const DEFAULT_SENSENOVA_MODELS = ["deepseek-v4-flash"];
const DEFAULT_SURVEYKIT_GATEWAY_MODELS = ["deepseek-v4-flash"];
const DEFAULT_VOLCENGINE_AGENT_PLAN_MODELS = ["glm-5.3-flash"];
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

function releaseInfo(env = {}) {
  return {
    version: String(env.SURVEYKIT_RELEASE || env.CF_PAGES_COMMIT_SHA || "unknown"),
    revision: String(env.SURVEYKIT_COMMIT || env.CF_PAGES_COMMIT_SHA || ""),
    deployed_at: String(env.SURVEYKIT_DEPLOYED_AT || ""),
  };
}
const TASK_TIER_MODEL_PRIORITY = {
  fast: ["glm-5.3-flash", "deepseek-v4-flash", "qwen3.6-plus"],
  storyline: ["glm-5.3-flash", "deepseek-v4-flash"],
  quality: ["glm-5.3-flash", "deepseek-v4-pro", "qwen3.7-max", "qwen3.7-plus", "deepseek-v4-flash"],
  structured: ["glm-5.3-flash", "deepseek-v4-flash", "qwen3.7-max", "qwen3.7-plus"],
};
const TASK_TIER_REQUEST_BUDGET_MS = {
  fast: 54_000,
  storyline: 22_000,
  structured: 54_000,
  quality: 82_000,
  balanced: 82_000,
};
const TASK_TIER_ATTEMPT_TIMEOUT_MS = {
  fast: 20_000,
  storyline: 16_000,
  structured: 24_000,
  quality: 38_000,
  balanced: 38_000,
};
const MIN_REMAINING_BUDGET_MS = 1_500;
const EXPOSED_HEADERS = [
  "X-Actual-Model",
  "X-AI-Source",
  "X-AI-Attempts",
  "X-AI-Attempt-Sources",
  "X-AI-Task-Tier",
  "X-AI-Request-ID",
  "X-AI-Duration-Ms",
  "X-AI-Rotation",
  "X-AI-Fallback-Used",
  "X-AI-Error-Type",
].join(", ");

function createRequestId(request) {
  const incoming = String(request?.headers?.get("X-Request-ID") || "").trim();
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotateEquivalentCandidates(configs, taskTier, rotationKey, mode = "deterministic") {
  if (mode === "off" || configs.length < 2) return { configs, label: mode === "off" ? "off" : "single" };
  const rotated = [];
  let groupCount = 0;
  for (let index = 0; index < configs.length;) {
    const model = configs[index]?.models?.[0] || "";
    let end = index + 1;
    while (end < configs.length && configs[end]?.models?.[0] === model) end += 1;
    const group = configs.slice(index, end);
    const offset = group.length > 1 ? stableHash(rotationKey + ":" + taskTier + ":" + model) % group.length : 0;
    rotated.push(...group.slice(offset), ...group.slice(0, offset));
    if (group.length > 1) groupCount += 1;
    index = end;
  }
  return { configs: rotated, label: groupCount ? "deterministic:" + groupCount : "single" };
}

function classifyFailure({ error, status, text, jsonInvalid = false, empty = false } = {}) {
  if (jsonInvalid) return "invalid_json";
  if (empty) return "empty_response";
  if (error?.name === "AbortError") return "timeout";
  if (error instanceof TypeError) return "network";
  if (containsQuotaOrAccessError(text)) return "quota";
  if (Number(status) >= 500) return "upstream_5xx";
  if (Number(status) >= 400) return "upstream_4xx";
  return "upstream_error";
}

function isRetryableFailure(type) {
  return ["timeout", "network", "quota", "upstream_5xx", "empty_response", "invalid_json", "upstream_error"].includes(type);
}

function aiHeaders(meta = {}) {
  return {
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    ...(meta.requestId ? { "X-AI-Request-ID": meta.requestId } : {}),
    ...(Number.isFinite(meta.durationMs) ? { "X-AI-Duration-Ms": String(meta.durationMs) } : {}),
    ...(meta.rotation ? { "X-AI-Rotation": meta.rotation } : {}),
    ...(meta.errorType ? { "X-AI-Error-Type": meta.errorType } : {}),
  };
}

function logAiRequest(meta) {
  console.log(JSON.stringify({ event: "ai_proxy_request", ...meta }));
}


function timeoutError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Request-ID, X-AI-Rotation-Key",
      "Cache-Control": "no-store",
      ...extraHeaders,
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
  const volcengineAgentPlanKey = String(
    env?.VOLCENGINE_AGENT_PLAN_API_KEY
    || env?.ARK_AGENT_PLAN_API_KEY
    || env?.ARK_API_KEY
    || "",
  ).trim();
  if (volcengineAgentPlanKey) {
    configs.push({
      apiKey: volcengineAgentPlanKey,
      models: configuredModels(
        env,
        "VOLCENGINE_AGENT_PLAN_MODELS",
        "VOLCENGINE_AGENT_PLAN_MODEL",
        DEFAULT_VOLCENGINE_AGENT_PLAN_MODELS,
      ),
      url: String(env?.VOLCENGINE_AGENT_PLAN_API_URL || BUILTIN_VOLCENGINE_AGENT_PLAN_URL).trim(),
      provider: "volcengine_agent_plan",
      source: "builtin-volcengine-agent-plan",
      timeoutMs: 240_000,
      attemptsPerModel: 1,
    });
  }
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

function routeBuiltinConfigs(configs, taskTier) {
  const priorities = TASK_TIER_MODEL_PRIORITY[taskTier];
  if (!priorities) return configs;
  const orderedConfigs = taskTier === "storyline"
    ? [...configs].sort((a, b) => Number(b.source === "builtin-sensenova") - Number(a.source === "builtin-sensenova"))
    : configs;
  const routed = [];
  for (const model of priorities) {
    for (const config of orderedConfigs) {
      if (config.models.includes(model)) routed.push({ ...config, models: [model] });
    }
  }
  return routed.length ? routed : orderedConfigs;
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
    const payload = JSON.parse(text);
    if (payload?.error) return true;
    const assistantContent = String(
      payload?.choices?.[0]?.message?.content
      || payload?.choices?.[0]?.text
      || payload?.message
      || "",
    );
    return containsQuotaOrAccessError(assistantContent);
  } catch {
    return containsQuotaOrAccessError(text);
  }
}

function containsQuotaOrAccessError(value) {
  const message = String(value || "").trim();
  if (!message) return false;
  return /(?:free\s+quota\s+exhausted|exceeded\s+(?:your\s+)?(?:current\s+)?quota|insufficient[_\s-]*quota|allocationquota|use\s+free\s+tier\s+only|add\s+funds|quota\s+(?:has\s+been\s+)?exhausted|billing\s+(?:quota|limit)|账户?余额不足|免费额度(?:已)?(?:用尽|耗尽)|额度(?:已)?(?:用尽|耗尽|不足)|欠费|无权限访问(?:该)?模型)/i.test(message);
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

async function callUpstream(targetUrl, apiKey, body, timeoutMs = 240_000, externalSignal = null) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
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
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function structuredProbeCandidates(configs) {
  const all = configs.flatMap((config) => (config.models || []).map((model) => ({ config, model })));
  if (!all.length) return [];
  const first = all[0];
  const alternate = all.find((candidate) =>
    candidate.model === first.model && candidate.config.source !== first.config.source
  );
  return alternate ? [first, alternate] : [];
}

async function prioritizeStructuredChannels(configs) {
  const candidates = structuredProbeCandidates(configs);
  if (candidates.length < 2) return configs;
  const controllers = candidates.map(() => new AbortController());
  const tasks = candidates.map((candidate, index) => (async () => {
    const targetUrl = validateTarget(candidate.config.provider, candidate.config.url, true);
    const probeBody = prepareBuiltinBody({
      model: candidate.model,
      messages: [{ role: "user", content: "channel-health-probe: reply OK" }],
      temperature: 0,
      max_tokens: 48,
    }, candidate.model);
    const result = await callUpstream(
      targetUrl,
      candidate.config.apiKey,
      probeBody,
      Math.min(4_000, candidate.config.timeoutMs),
      controllers[index].signal,
    );
    if (!result.upstream.ok || !result.text.trim() || containsUpstreamError(result.text)) {
      throw new Error(`${candidate.config.source} probe failed`);
    }
    return candidate.config;
  })());
  try {
    const winner = await Promise.any(tasks);
    return [winner, ...configs.filter((config) => config !== winner)];
  } catch {
    return configs;
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
}
function upstreamResponse(text, upstream, model, source, attempts = [], taskTier = "balanced", meta = {}) {
  return new Response(text || upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": EXPOSED_HEADERS,
      "Cache-Control": "no-store",
      "X-Actual-Model": upstream.headers.get("X-Actual-Model") || model,
      "X-AI-Source": source,
      "X-AI-Attempts": attempts.map((item) => item.model).join(","),
      "X-AI-Attempt-Sources": attempts.map((item) => item.source + ":" + item.model).join(","),
      "X-AI-Task-Tier": taskTier,
      "X-AI-Fallback-Used": attempts.length > 1 ? "1" : "0",
      ...aiHeaders(meta),
    },
  });
}

export async function onRequest({ request, env }) {
  const requestId = createRequestId(request);
  const requestStartedAt = Date.now();
  let taskTier = "balanced";
  let rotationLabel = "none";
  const attempts = [];

  const fail = (message, status, type, extra = {}) => {
    const durationMs = Date.now() - requestStartedAt;
    const errorType = type || "internal";
    logAiRequest({
      request_id: requestId,
      task_tier: taskTier,
      status,
      outcome: "error",
      error_type: errorType,
      duration_ms: durationMs,
      rotation: rotationLabel,
      attempts,
    });
    return json({
      error: {
        message,
        type: errorType,
        request_id: requestId,
        retryable: isRetryableFailure(errorType),
        ...extra,
      },
    }, status, aiHeaders({ requestId, durationMs, rotation: rotationLabel, errorType }));
  };

  if (request.method === "OPTIONS") {
    return json({ ok: true }, 200, aiHeaders({ requestId, durationMs: 0, rotation: "none" }));
  }
  if (request.method === "GET") {
    const configs = getBuiltinConfigs(env);
    return json({
      ok: true,
      service: "ai-proxy",
      release: releaseInfo(env),
      rotation_mode: String(env?.AI_ROTATION_MODE || "deterministic").toLowerCase() === "off"
        ? "off"
        : "deterministic",
      configured_sources: configs.map((config) => ({
        source: config.source,
        models: config.models,
      })),
      task_tiers: Object.keys(TASK_TIER_REQUEST_BUDGET_MS),
    }, 200, aiHeaders({ requestId, durationMs: Date.now() - requestStartedAt, rotation: "health" }));
  }
  if (request.method !== "POST") return fail("Method not allowed", 405, "invalid_request");

  const contentLength = Number(request.headers.get("Content-Length")) || 0;
  if (contentLength > MAX_BODY_BYTES) {
    return fail("\u0041\u0049 \u8bf7\u6c42\u5185\u5bb9\u8fc7\u5927\u3002", 413, "invalid_request", { code: "REQUEST_BODY_TOO_LARGE" });
  }

  try {
    const payload = await request.json();
    const body = payload.body;
    if (!body?.model || !Array.isArray(body.messages)) {
      return fail("\u6a21\u578b\u6216\u6d88\u606f\u5185\u5bb9\u4e0d\u5b8c\u6574\u3002", 400, "invalid_request");
    }

    const clientApiKey = String(payload.apiKey || "").trim();
    const useBuiltin = !clientApiKey;
    taskTier = ["fast", "quality", "structured", "storyline"].includes(payload.taskTier)
      ? payload.taskTier
      : "balanced";
    const requestBudgetMs = TASK_TIER_REQUEST_BUDGET_MS[taskTier] || TASK_TIER_REQUEST_BUDGET_MS.balanced;
    const attemptTimeoutLimitMs = TASK_TIER_ATTEMPT_TIMEOUT_MS[taskTier] || TASK_TIER_ATTEMPT_TIMEOUT_MS.balanced;
    let builtins = useBuiltin ? routeBuiltinConfigs(getBuiltinConfigs(env), taskTier) : [];

    if (useBuiltin && !builtins.length) {
      return fail("\u5e73\u53f0\u5185\u7f6e \u0041\u0049 \u670d\u52a1\u5c1a\u672a\u5b8c\u6210\u914d\u7f6e\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002", 503, "not_configured");
    }

    if (!useBuiltin) {
      const targetUrl = validateTarget(payload.provider || "custom", payload.url);
      const attemptStartedAt = Date.now();
      let upstreamResult;
      try {
        upstreamResult = await callUpstream(
          targetUrl,
          clientApiKey,
          body,
          body.stream ? 280_000 : requestBudgetMs,
        );
      } catch (error) {
        const errorType = classifyFailure({ error });
        attempts.push({
          source: "user-key",
          model: body.model,
          duration_ms: Date.now() - attemptStartedAt,
          outcome: errorType,
        });
        const status = errorType === "timeout" ? 504 : 502;
        return fail(
          errorType === "timeout" ? "\u6a21\u578b\u54cd\u5e94\u8d85\u65f6\uff0c\u8bf7\u7f29\u77ed\u8f93\u5165\u6216\u7a0d\u540e\u91cd\u8bd5\u3002" : "\u6a21\u578b\u670d\u52a1\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
          status,
          errorType,
        );
      }

      const { upstream, text } = upstreamResult;
      const errorType = upstream.ok && (body.stream || text.trim())
        ? ""
        : classifyFailure({ status: upstream.status, text, empty: !body.stream && !text.trim() });
      attempts.push({
        source: "user-key",
        model: body.model,
        status: upstream.status,
        duration_ms: Date.now() - attemptStartedAt,
        outcome: errorType || "success",
      });
      if (!body.stream && !text.trim()) {
        return fail("\u6a21\u578b\u8fd4\u56de\u4e3a\u7a7a\uff0c\u8bf7\u68c0\u67e5\u6a21\u578b\u540d\u79f0\u3001\u989d\u5ea6\u6216\u670d\u52a1\u72b6\u6001\u3002", 502, "empty_response");
      }

      const durationMs = Date.now() - requestStartedAt;
      logAiRequest({
        request_id: requestId,
        task_tier: taskTier,
        status: upstream.status,
        outcome: errorType ? "error" : "success",
        error_type: errorType || undefined,
        duration_ms: durationMs,
        rotation: "user-key",
        attempts,
      });
      return upstreamResponse(
        body.stream && upstream.ok ? "" : text,
        upstream,
        body.model,
        "user-key",
        attempts,
        taskTier,
        { requestId, durationMs, rotation: "user-key", errorType: errorType || undefined },
      );
    }

    const rotationMode = String(env?.AI_ROTATION_MODE || "deterministic").toLowerCase() === "off"
      ? "off"
      : "deterministic";
    const rotationKey = String(
      request.headers.get("X-AI-Rotation-Key")
      || payload.rotationKey
      || requestId,
    );
    const rotated = rotateEquivalentCandidates(builtins, taskTier, rotationKey, rotationMode);
    builtins = rotated.configs;
    rotationLabel = rotated.label;

    const wantsJson = body.response_format?.type === "json_object";
    if (taskTier === "structured" && wantsJson && !body.stream) {
      builtins = await prioritizeStructuredChannels(builtins);
      rotationLabel = "probe+" + rotationLabel;
    }

    let lastError = null;
    let lastFailureType = "upstream_error";
    providerLoop:
    for (const builtin of builtins) {
      const targetUrl = validateTarget(builtin.provider, builtin.url, true);
      for (const model of builtin.models) {
        const configuredAttempts = Math.max(1, Number(builtin.attemptsPerModel) || 1);
        const hasEquivalentAlternative = builtins.some((candidate) =>
          candidate !== builtin && candidate.models.includes(model)
        );
        const attemptCount = hasEquivalentAlternative || ["fast", "structured", "storyline"].includes(taskTier)
          ? 1
          : configuredAttempts;
        for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
          const remainingMs = requestBudgetMs - (Date.now() - requestStartedAt);
          if (remainingMs < MIN_REMAINING_BUDGET_MS) {
            lastError = timeoutError("AI proxy request budget exhausted");
            lastFailureType = "timeout";
            break providerLoop;
          }

          const upstreamBody = prepareBuiltinBody(body, model);
          const attemptTimeoutMs = Math.max(
            1_000,
            Math.min(builtin.timeoutMs, attemptTimeoutLimitMs, remainingMs - 500),
          );
          const attemptStartedAt = Date.now();
          let result;
          try {
            result = await callUpstream(targetUrl, builtin.apiKey, upstreamBody, attemptTimeoutMs);
          } catch (error) {
            lastError = error;
            lastFailureType = classifyFailure({ error });
            attempts.push({
              source: builtin.source,
              model,
              duration_ms: Date.now() - attemptStartedAt,
              outcome: lastFailureType,
            });
            continue;
          }

          const empty = !result.stream && !result.text.trim();
          const jsonInvalid = wantsJson && !result.stream && result.upstream.ok && !containsJsonObject(result.text);
          const upstreamInvalid = !result.upstream.ok || empty || containsUpstreamError(result.text) || jsonInvalid;
          lastFailureType = upstreamInvalid
            ? classifyFailure({
                status: result.upstream.status,
                text: result.text,
                jsonInvalid,
                empty,
              })
            : "";
          attempts.push({
            source: builtin.source,
            model,
            status: result.upstream.status,
            duration_ms: Date.now() - attemptStartedAt,
            outcome: lastFailureType || "success",
          });

          if (upstreamInvalid) continue;

          const durationMs = Date.now() - requestStartedAt;
          logAiRequest({
            request_id: requestId,
            task_tier: taskTier,
            status: result.upstream.status,
            outcome: "success",
            duration_ms: durationMs,
            rotation: rotationLabel,
            actual_source: builtin.source,
            actual_model: model,
            fallback_used: attempts.length > 1,
            attempts,
          });
          return upstreamResponse(
            result.stream ? "" : result.text,
            result.upstream,
            model,
            builtin.source,
            attempts,
            taskTier,
            { requestId, durationMs, rotation: rotationLabel },
          );
        }
      }
    }

    const reason = lastFailureType === "invalid_json"
      ? "\u6240\u6709\u5185\u7f6e\u6a21\u578b\u5747\u672a\u8fd4\u56de\u6709\u6548\u7684 JSON"
      : (lastFailureType === "timeout"
        ? "\u6a21\u578b\u54cd\u5e94\u8d85\u65f6"
        : (lastError?.message || "\u4e0a\u6e38\u6a21\u578b\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9"));
    const status = lastFailureType === "timeout" ? 504 : 502;
    return fail("\u6240\u6709\u5185\u7f6e AI \u670d\u52a1\u5747\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9\uff1a" + reason + "\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002", status, lastFailureType);
  } catch (error) {
    const type = error instanceof SyntaxError || /missing|only|not allowed|does not match|invalid|\u4e0d\u5b8c\u6574|\u4e0d\u5141\u8bb8/i.test(error?.message || "")
      ? "invalid_request"
      : classifyFailure({ error });
    const status = type === "invalid_request" ? 400 : (type === "timeout" ? 504 : 502);
    return fail(error.message || "AI \u4ee3\u7406\u8c03\u7528\u5931\u8d25\u3002", status, type);
  }
}
