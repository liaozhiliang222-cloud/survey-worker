"use strict";

const { collectRequestBody, bodyLimitError } = require("./request-body");
const { sendJson } = require("./http-response");
const { Readable } = require("node:stream");
const { randomUUID } = require("node:crypto");
const { releaseInfo } = require("./release-info");

const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  sensenova: ["token.sensenova.cn", "api.sensenova.cn"],
  surveykit_gateway: ["api.surveykit.cc"],
  openai: ["api.openai.com"],
};
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
const TASK_TIER_MODEL_PRIORITY = {
  fast: ["deepseek-v4-flash", "qwen3.6-plus"],
  storyline: ["deepseek-v4-flash"],
  quality: ["deepseek-v4-pro", "qwen3.7-max", "qwen3.7-plus", "deepseek-v4-flash"],
  structured: ["deepseek-v4-flash", "qwen3.7-max", "qwen3.7-plus"],
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

function isRetryableFailure(type) {
  return ["timeout", "network", "quota", "upstream_5xx", "empty_response", "invalid_json", "upstream_error"].includes(type);
}


function timeoutError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createAiProxyHandler({ env = {}, maxBodyBytes, fetchImpl = globalThis.fetch }) {
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) throw new Error("AI body limit must be positive.");
  if (typeof fetchImpl !== "function") throw new Error("AI proxy requires fetch.");

  function allowedHosts() {
    const extra = String(env.AI_PROXY_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return new Set([...Object.values(PROVIDER_HOSTS).flat(), ...extra]);
  }

  function validateTarget(provider, rawUrl, allowInsecureBuiltin = false) {
    if (!rawUrl) throw new Error("Missing provider API URL.");
    const url = new URL(rawUrl);
    const isSurveykitGateway = allowInsecureBuiltin && provider === "surveykit_gateway"
      && url.protocol === "http:"
      && url.hostname.toLowerCase() === "api.surveykit.cc";
    if (url.protocol !== "https:" && !isSurveykitGateway) throw new Error("Only HTTPS model APIs are allowed.");
    if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
      throw new Error("Only OpenAI-compatible /chat/completions APIs are supported.");
    }
    const host = url.hostname.toLowerCase();
    const providerHostList = PROVIDER_HOSTS[provider];
    if (providerHostList && !providerHostList.includes(host)) {
      throw new Error("Model provider does not match the API host.");
    }
    if (!providerHostList && !allowedHosts().has(host)) {
      throw new Error(`Model API host is not allowed: ${host}`);
    }
    return url.toString();
  }

  function configuredModels(pluralKey, singularKey, defaults) {
    const configured = String(env[pluralKey] || env[singularKey] || "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    return configured.length ? configured : defaults;
  }

  function builtinConfigs() {
    const configs = [];
    const surveykitGatewayKey = String(env.SURVEYKIT_GATEWAY_API_KEY || "").trim();
    if (surveykitGatewayKey) {
      configs.push({
        apiKey: surveykitGatewayKey,
        models: configuredModels(
          "SURVEYKIT_GATEWAY_MODELS",
          "SURVEYKIT_GATEWAY_MODEL",
          DEFAULT_SURVEYKIT_GATEWAY_MODELS,
        ),
        url: String(env.SURVEYKIT_GATEWAY_API_URL || BUILTIN_SURVEYKIT_GATEWAY_URL).trim(),
        provider: "surveykit_gateway",
        source: "builtin-surveykit-gateway",
        timeoutMs: 90_000,
        attemptsPerModel: 3,
      });
    }

    const sensenovaKey = String(env.SENSENOVA_API_KEY || "").trim();
    if (sensenovaKey) {
      configs.push({
        apiKey: sensenovaKey,
        models: configuredModels("SENSENOVA_MODELS", "SENSENOVA_MODEL", DEFAULT_SENSENOVA_MODELS),
        url: String(env.SENSENOVA_API_URL || BUILTIN_SENSENOVA_URL).trim(),
        provider: "sensenova",
        source: "builtin-sensenova",
        timeoutMs: 90_000,
        attemptsPerModel: 1,
      });
    }

    const bailianKey = String(
      env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY || env.AI_API_KEY || "",
    ).trim();
    if (bailianKey) {
      configs.push({
        apiKey: bailianKey,
        models: configuredModels("BAILIAN_MODELS", "BAILIAN_MODEL", DEFAULT_BUILTIN_MODELS),
        url: String(env.BAILIAN_API_URL || BUILTIN_BAILIAN_URL).trim(),
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

  function prepareBuiltinBody(body, model) {
    const next = { ...body, model };
    if (/^deepseek-/i.test(model)) delete next.response_format;
    return next;
  }

  function responseHasUpstreamError(text) {
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

  function responseContainsJson(text) {
    try {
      const payload = JSON.parse(text);
      const content = String(
        payload?.choices?.[0]?.message?.content
        || payload?.choices?.[0]?.message?.reasoning_content
        || payload?.choices?.[0]?.text
        || "",
      ).trim();
      const candidate = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
        || content.match(/\{[\s\S]*\}/)?.[0]
        || content;
      const parsed = JSON.parse(candidate.replace(/^\uFEFF/, "").trim());
      return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    } catch {
      return false;
    }
  }

  async function requestModel(targetUrl, apiKey, body, timeoutMs = 240_000, externalSignal = null) {
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchImpl(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
      const result = await requestModel(
        targetUrl,
        candidate.config.apiKey,
        probeBody,
        Math.min(4_000, candidate.config.timeoutMs),
        controllers[index].signal,
      );
      if (!result.upstream.ok || !result.text.trim() || responseHasUpstreamError(result.text)) {
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

  function requestIdFor(req) {
    const incoming = String(req.headers["x-request-id"] || "").trim();
    return /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  }

  function tracingHeaders({ requestId, durationMs, rotation, errorType } = {}) {
    return {
      "Access-Control-Expose-Headers": EXPOSED_HEADERS,
      ...(requestId ? { "X-AI-Request-ID": requestId } : {}),
      ...(Number.isFinite(durationMs) ? { "X-AI-Duration-Ms": String(durationMs) } : {}),
      ...(rotation ? { "X-AI-Rotation": rotation } : {}),
      ...(errorType ? { "X-AI-Error-Type": errorType } : {}),
    };
  }

  return function handleAiProxy(req, res) {
    const requestId = requestIdFor(req);
    const requestStartedAt = Date.now();
    let taskTier = "balanced";
    let rotationLabel = "none";
    const attempts = [];

    const finishError = (status, message, type, extra = {}, extraHeaders = {}) => {
      const durationMs = Date.now() - requestStartedAt;
      const errorType = type || "internal";
      console.log(JSON.stringify({
        event: "ai_proxy_request",
        request_id: requestId,
        task_tier: taskTier,
        status,
        outcome: "error",
        error_type: errorType,
        duration_ms: durationMs,
        rotation: rotationLabel,
        attempts,
      }));
      sendJson(res, status, {
        error: {
          message,
          type: errorType,
          request_id: requestId,
          retryable: isRetryableFailure(errorType),
          ...extra,
        },
      }, { ...tracingHeaders({ requestId, durationMs, rotation: rotationLabel, errorType }), ...extraHeaders });
    };

    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true }, tracingHeaders({ requestId, durationMs: 0, rotation: "none" }));
      return;
    }
    if (req.method === "GET") {
      const configs = builtinConfigs();
      sendJson(res, 200, {
        ok: true,
        service: "ai-proxy",
        release: releaseInfo(env),
        rotation_mode: String(env.AI_ROTATION_MODE || "deterministic").toLowerCase() === "off" ? "off" : "deterministic",
        configured_sources: configs.map((config) => ({ source: config.source, models: config.models })),
        task_tiers: Object.keys(TASK_TIER_REQUEST_BUDGET_MS),
      }, tracingHeaders({ requestId, durationMs: Date.now() - requestStartedAt, rotation: "health" }));
      return;
    }
    if (req.method !== "POST") {
      finishError(405, "Method not allowed.", "invalid_request", {}, { Allow: "GET, POST, OPTIONS" });
      return;
    }

    collectRequestBody(req, maxBodyBytes, async ({ body, error, tooLarge }) => {
      if (error) {
        finishError(400, "\u8bfb\u53d6 AI \u8bf7\u6c42\u5931\u8d25\uff1a" + error.message, "invalid_request");
        return;
      }
      if (tooLarge) {
        const limitError = bodyLimitError("AI", maxBodyBytes).error;
        finishError(413, limitError.message, "invalid_request", { code: limitError.code });
        return;
      }

      try {
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const requestBody = payload.body;
        if (!requestBody?.model || !Array.isArray(requestBody.messages)) {
          finishError(400, "Missing model or messages.", "invalid_request");
          return;
        }

        const clientApiKey = String(payload.apiKey || "").trim();
        const useBuiltin = !clientApiKey;
        taskTier = ["fast", "quality", "structured", "storyline"].includes(payload.taskTier)
          ? payload.taskTier
          : "balanced";
        const requestBudgetMs = TASK_TIER_REQUEST_BUDGET_MS[taskTier] || TASK_TIER_REQUEST_BUDGET_MS.balanced;
        const attemptTimeoutLimitMs = TASK_TIER_ATTEMPT_TIMEOUT_MS[taskTier] || TASK_TIER_ATTEMPT_TIMEOUT_MS.balanced;
        let configs = useBuiltin
          ? routeBuiltinConfigs(builtinConfigs(), taskTier)
          : [{
              apiKey: clientApiKey,
              models: [requestBody.model],
              url: payload.url,
              provider: payload.provider || "custom",
              source: "user-key",
              timeoutMs: 280_000,
              attemptsPerModel: 1,
            }];
        if (!configs.length) {
          finishError(503, "Built-in AI service is not configured.", "not_configured");
          return;
        }

        if (useBuiltin) {
          const rotationMode = String(env.AI_ROTATION_MODE || "deterministic").toLowerCase() === "off" ? "off" : "deterministic";
          const rotationKey = String(req.headers["x-ai-rotation-key"] || payload.rotationKey || requestId);
          const rotated = rotateEquivalentCandidates(configs, taskTier, rotationKey, rotationMode);
          configs = rotated.configs;
          rotationLabel = rotated.label;
        } else {
          rotationLabel = "user-key";
        }

        const wantsJson = requestBody.response_format?.type === "json_object";
        if (useBuiltin && taskTier === "structured" && wantsJson && !requestBody.stream) {
          configs = await prioritizeStructuredChannels(configs);
          rotationLabel = "probe+" + rotationLabel;
        }

        let result = null;
        let lastError = null;
        let lastFailureType = "upstream_error";
        let actualModel = requestBody.model;
        let actualConfig = configs[0];
        providerLoop:
        for (const config of configs) {
          const targetUrl = validateTarget(config.provider, config.url, useBuiltin);
          for (const model of config.models) {
            const configuredAttempts = Math.max(1, Number(config.attemptsPerModel) || 1);
            const hasEquivalentAlternative = useBuiltin && configs.some((candidate) =>
              candidate !== config && candidate.models.includes(model)
            );
            const attemptCount = hasEquivalentAlternative || ["fast", "structured", "storyline"].includes(taskTier) ? 1 : configuredAttempts;
            for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
              const remainingMs = requestBudgetMs - (Date.now() - requestStartedAt);
              if (remainingMs < MIN_REMAINING_BUDGET_MS) {
                lastError = timeoutError("AI proxy request budget exhausted");
                lastFailureType = "timeout";
                break providerLoop;
              }

              const upstreamBody = useBuiltin ? prepareBuiltinBody(requestBody, model) : requestBody;
              const attemptTimeoutMs = Math.max(1_000, Math.min(config.timeoutMs, attemptTimeoutLimitMs, remainingMs - 500));
              const attemptStartedAt = Date.now();
              try {
                result = await requestModel(targetUrl, config.apiKey, upstreamBody, attemptTimeoutMs);
              } catch (upstreamError) {
                lastError = upstreamError;
                result = null;
                lastFailureType = classifyFailure({ error: upstreamError });
                attempts.push({ source: config.source, model, duration_ms: Date.now() - attemptStartedAt, outcome: lastFailureType });
                continue;
              }

              actualModel = model;
              actualConfig = config;
              const empty = !result.stream && !result.text.trim();
              const jsonInvalid = useBuiltin && wantsJson && !result.stream && result.upstream.ok && !responseContainsJson(result.text);
              const invalid = !result.upstream.ok || empty || responseHasUpstreamError(result.text) || jsonInvalid;
              lastFailureType = invalid
                ? classifyFailure({ status: result.upstream.status, text: result.text, jsonInvalid, empty })
                : "";
              attempts.push({
                source: config.source,
                model,
                status: result.upstream.status,
                duration_ms: Date.now() - attemptStartedAt,
                outcome: lastFailureType || "success",
              });
              if (invalid) continue;

              const durationMs = Date.now() - requestStartedAt;
              console.log(JSON.stringify({
                event: "ai_proxy_request",
                request_id: requestId,
                task_tier: taskTier,
                status: result.upstream.status,
                outcome: "success",
                duration_ms: durationMs,
                rotation: rotationLabel,
                actual_source: actualConfig.source,
                actual_model: actualModel,
                fallback_used: attempts.length > 1,
                attempts,
              }));
              res.writeHead(result.upstream.status, {
                "Content-Type": result.upstream.headers.get("content-type") || "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": EXPOSED_HEADERS,
                "Cache-Control": "no-store",
                "X-Actual-Model": result.upstream.headers.get("X-Actual-Model") || actualModel,
                "X-AI-Source": actualConfig.source,
                "X-AI-Attempts": attempts.map((item) => item.model).join(","),
                "X-AI-Attempt-Sources": attempts.map((item) => item.source + ":" + item.model).join(","),
                "X-AI-Task-Tier": taskTier,
                "X-AI-Fallback-Used": attempts.length > 1 ? "1" : "0",
                ...tracingHeaders({ requestId, durationMs, rotation: rotationLabel }),
              });
              if (result.stream && result.upstream.body) {
                const readable = Readable.fromWeb(result.upstream.body);
                readable.once("error", (streamError) => res.destroy(streamError));
                readable.pipe(res);
                return;
              }
              res.end(result.text);
              return;
            }
          }
        }

        const reason = lastFailureType === "invalid_json"
          ? "All built-in models failed to return valid JSON."
          : (lastFailureType === "timeout" ? "Model response timed out." : (lastError?.message || "Upstream model returned no valid content."));
        finishError(lastFailureType === "timeout" ? 504 : 502, reason, lastFailureType);
      } catch (handlerError) {
        const message = handlerError.message || "AI proxy request failed.";
        const type = handlerError instanceof SyntaxError || /missing|only|not allowed|does not match|invalid/i.test(message)
          ? "invalid_request"
          : classifyFailure({ error: handlerError });
        finishError(type === "invalid_request" ? 400 : (type === "timeout" ? 504 : 502), message, type);
      }
    });
  };
}

module.exports = { createAiProxyHandler };
