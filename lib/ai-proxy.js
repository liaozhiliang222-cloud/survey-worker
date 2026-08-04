"use strict";

const { collectRequestBody, bodyLimitError } = require("./request-body");
const { sendJson } = require("./http-response");
const { Readable } = require("node:stream");

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
  return function handleAiProxy(req, res) {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { message: "Method not allowed." } }, { Allow: "POST, OPTIONS" });
      return;
    }

    collectRequestBody(req, maxBodyBytes, async ({ body, error, tooLarge }) => {
      if (error) {
        sendJson(res, 400, { error: { message: `读取 AI 请求失败：${error.message}` } });
        return;
      }
      if (tooLarge) {
        sendJson(res, 413, bodyLimitError("AI", maxBodyBytes));
        return;
      }

      try {
        const payload = JSON.parse(body.toString("utf8") || "{}");
        const requestBody = payload.body;
        if (!requestBody?.model || !Array.isArray(requestBody.messages)) {
          sendJson(res, 400, { error: { message: "Missing model or messages." } });
          return;
        }

        const clientApiKey = String(payload.apiKey || "").trim();
        const useBuiltin = !clientApiKey;
        const taskTier = ["fast", "quality", "structured", "storyline"].includes(payload.taskTier) ? payload.taskTier : "balanced";
        const requestStartedAt = Date.now();
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
          sendJson(res, 503, { error: { message: "Built-in AI service is not configured." } });
          return;
        }

        const wantsJson = requestBody.response_format?.type === "json_object";
        if (useBuiltin && taskTier === "structured" && wantsJson && !requestBody.stream) {
          configs = await prioritizeStructuredChannels(configs);
        }
        const attempts = [];
        let result = null;
        let jsonValidated = false;
        let lastError = null;
        let actualModel = requestBody.model;
        let actualConfig = configs[0];
        providerLoop:
        for (const config of configs) {
          const targetUrl = validateTarget(config.provider, config.url, useBuiltin);
          for (const model of config.models) {
            const configuredAttempts = Math.max(1, Number(config.attemptsPerModel) || 1);
            const attemptCount = ["fast", "structured"].includes(taskTier) ? 1 : configuredAttempts;
            for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
              const remainingMs = requestBudgetMs - (Date.now() - requestStartedAt);
              if (remainingMs < MIN_REMAINING_BUDGET_MS) {
                lastError = timeoutError("AI proxy request budget exhausted");
                break providerLoop;
              }
              attempts.push(model);
              const upstreamBody = useBuiltin ? prepareBuiltinBody(requestBody, model) : requestBody;
              const attemptTimeoutMs = Math.max(
                1_000,
                Math.min(config.timeoutMs, attemptTimeoutLimitMs, remainingMs - 500),
              );
              try {
                result = await requestModel(targetUrl, config.apiKey, upstreamBody, attemptTimeoutMs);
              } catch (error) {
                lastError = error;
                result = null;
                continue;
              }
              actualModel = model;
              actualConfig = config;
              if (result.stream) {
                jsonValidated = true;
                break;
              }
              if (!result.upstream.ok || !result.text.trim() || responseHasUpstreamError(result.text)) continue;
              if (useBuiltin && wantsJson && !responseContainsJson(result.text)) continue;
              jsonValidated = true;
              break;
            }
            if (result?.stream
              || (result?.upstream.ok && result.text.trim()
                && !responseHasUpstreamError(result.text)
                && (!useBuiltin || !wantsJson || responseContainsJson(result.text)))) break;
          }
          if (result?.stream
            || (result?.upstream.ok && result.text.trim()
              && !responseHasUpstreamError(result.text)
              && (!useBuiltin || !wantsJson || responseContainsJson(result.text)))) break;
        }
        const jsonInvalid = useBuiltin && wantsJson && !jsonValidated && Boolean(result?.upstream?.ok) && !result?.stream;
        if (jsonInvalid || (!result?.stream && !result?.text?.trim())) {
          const reason = jsonInvalid
            ? "All built-in models failed to return valid JSON."
            : (lastError?.name === "AbortError" ? "Model response timed out." : (lastError?.message || "Model returned an empty response."));
          sendJson(res, lastError?.name === "AbortError" ? 504 : 502, { error: { message: reason } });
          return;
        }

        res.writeHead(result.upstream.status, {
          "Content-Type": result.upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-Actual-Model": result.upstream.headers.get("X-Actual-Model") || actualModel,
          "X-AI-Source": actualConfig.source,
          "X-AI-Attempts": attempts.join(","),
          "X-AI-Task-Tier": taskTier,
        });
        if (result.stream && result.upstream.body) {
          const readable = Readable.fromWeb(result.upstream.body);
          readable.once("error", (error) => res.destroy(error));
          readable.pipe(res);
          return;
        }
        res.end(result.text);
      } catch (error) {
        const message = error.message || "AI proxy request failed.";
        const status = error?.name === "AbortError"
          ? 504
          : (error instanceof SyntaxError || /missing|only|not allowed|does not match|invalid/i.test(message)
            ? 400
            : 502);
        sendJson(res, status, { error: { message } });
      }
    });
  };
}

module.exports = { createAiProxyHandler };
