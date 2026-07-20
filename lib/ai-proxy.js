"use strict";

const { collectRequestBody, bodyLimitError } = require("./request-body");
const { sendJson } = require("./http-response");

const PROVIDER_HOSTS = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"],
};
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

  function validateTarget(provider, rawUrl) {
    if (!rawUrl) throw new Error("Missing provider API URL.");
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("Only HTTPS model APIs are allowed.");
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

  function builtinModels() {
    const configured = String(env.BAILIAN_MODELS || env.BAILIAN_MODEL || "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    return configured.length ? configured : DEFAULT_BUILTIN_MODELS;
  }

  function prepareBuiltinBody(body, model) {
    const next = { ...body, model };
    if (/^deepseek-/i.test(model)) delete next.response_format;
    return next;
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

  async function requestModel(targetUrl, apiKey, body, timeoutMs = 240_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchImpl(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { upstream, text: await upstream.text() };
    } finally {
      clearTimeout(timeout);
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
        const targetUrl = validateTarget(
          useBuiltin ? "qwen" : (payload.provider || "custom"),
          useBuiltin ? (env.BAILIAN_API_URL || BUILTIN_BAILIAN_URL) : payload.url,
        );
        const apiKey = useBuiltin
          ? String(env.DASHSCOPE_API_KEY || env.BAILIAN_API_KEY || env.AI_API_KEY || "").trim()
          : clientApiKey;
        if (!apiKey) {
          sendJson(res, 503, { error: { message: "Built-in Bailian service is not configured." } });
          return;
        }

        const wantsJson = requestBody.response_format?.type === "json_object";
        const models = useBuiltin ? builtinModels() : [requestBody.model];
        const attempts = [];
        let result = null;
        let lastError = null;
        let actualModel = requestBody.model;
        for (const model of models) {
          attempts.push(model);
          const upstreamBody = useBuiltin ? prepareBuiltinBody(requestBody, model) : requestBody;
          try {
            result = await requestModel(targetUrl, apiKey, upstreamBody, useBuiltin ? 240_000 : 540_000);
          } catch (error) {
            lastError = error;
            result = null;
            continue;
          }
          actualModel = model;
          if (!result.upstream.ok || !result.text.trim()) continue;
          if (useBuiltin && wantsJson && !responseContainsJson(result.text)) continue;
          break;
        }
        if (!result?.text?.trim()) {
          const reason = lastError?.name === "AbortError" ? "Model response timed out." : (lastError?.message || "Model returned an empty response.");
          sendJson(res, 502, { error: { message: reason } });
          return;
        }

        res.writeHead(result.upstream.status, {
          "Content-Type": result.upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-Actual-Model": result.upstream.headers.get("X-Actual-Model") || actualModel,
          "X-AI-Source": useBuiltin ? "builtin-bailian" : "user-key",
          "X-AI-Attempts": attempts.join(","),
        });
        res.end(result.text);
      } catch (error) {
        const message = error.message || "AI proxy request failed.";
        const status = error instanceof SyntaxError || /missing|only|not allowed|does not match|invalid/i.test(message)
          ? 400
          : 502;
        sendJson(res, status, { error: { message } });
      }
    });
  };
}

module.exports = { createAiProxyHandler };
