/**
 * AI 调用封装 — 多 provider 预设 + 流式/非流式请求 + 重试
 */

import { loadJson, saveJson } from "./storage.js";

// ─── Provider 预设 ──────────────────────────────────────────

export const aiProviderPresets = {
  deepseek: {
    name: "DeepSeek",
    model: "deepseek-v4-pro",
    url: "https://api.deepseek.com/v1/chat/completions",
    tiers: [
      { label: "V4 Pro（默认）", model: "deepseek-v4-pro" },
      { label: "V4 Flash（快速/低成本）", model: "deepseek-v4-flash" }
    ]
  },
  kimi: {
    name: "Kimi（月之暗面）",
    model: "moonshot-v1-8k",
    url: "https://api.moonshot.cn/v1/chat/completions",
    tiers: [
      { label: "V1-8K", model: "moonshot-v1-8k" },
      { label: "V1-32K", model: "moonshot-v1-32k" },
      { label: "V1-128K", model: "moonshot-v1-128k" }
    ]
  },
  zhipu: {
    name: "智谱 GLM",
    model: "glm-5.1",
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    tiers: [
      { label: "GLM-4.7-Flash（免费）", model: "glm-4.7-flash" },
      { label: "GLM-5.1（旗舰）", model: "glm-5.1" },
      { label: "GLM-5.2（最新）", model: "glm-5.2" }
    ]
  },
  qwen: {
    name: "Qwen / 通义千问",
    model: "qwen3.7-max",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    tiers: [
      { label: "Qwen3.7 Max（最新旗舰）", model: "qwen3.7-max" },
      { label: "Qwen3.7 Plus", model: "qwen3.7-plus" },
      { label: "Qwen3.6 Max Preview", model: "qwen3.6-max-preview" },
      { label: "Qwen3.6 Plus", model: "qwen3.6-plus" },
      { label: "Qwen3.6 Flash（免费）", model: "qwen3.6-flash" },
      { label: "Qwen-Max（经典）", model: "qwen-max" },
      { label: "Qwen-Plus（经典）", model: "qwen-plus" },
      { label: "Qwen-Turbo（经典）", model: "qwen-turbo" }
    ]
  },
  openai: {
    name: "OpenAI",
    model: "gpt-4o",
    url: "https://api.openai.com/v1/chat/completions",
    tiers: [
      { label: "GPT-4o", model: "gpt-4o" },
      { label: "GPT-4o-mini", model: "gpt-4o-mini" },
      { label: "GPT-4-Turbo", model: "gpt-4-turbo" }
    ]
  }
};

// ─── Settings 管理 ──────────────────────────────────────────

export function getDefaultAiSettings(provider = "deepseek") {
  const preset = aiProviderPresets[provider] || aiProviderPresets.deepseek;
  const tier = preset.tiers?.[0] || { model: preset.model };
  return {
    provider,
    mode: "api",
    modelTier: tier.model,
    model: tier.model || preset.model,
    url: preset.url,
    apiKey: ""
  };
}

export function loadAiSettings() {
  const saved = loadJson("surveyAiSettings", null);
  if (saved) return { ...getDefaultAiSettings(saved.provider || "deepseek"), ...saved, mode: "api" };
  return getDefaultAiSettings("deepseek");
}

export function persistAiSettings(settings) {
  saveJson("surveyAiSettings", settings);
}

export function validateAiSettings(settings) {
  const errors = [];
  if (!aiProviderPresets[settings.provider]) errors.push("请选择有效的大模型供应商。");
  if (!settings.model) errors.push("请填写模型名称。");
  if (!settings.url) {
    errors.push("请填写接口地址。");
  } else {
    try {
      const url = new URL(settings.url);
      if (!/^https?:$/.test(url.protocol)) errors.push("接口地址必须以 http 或 https 开头。");
      if (!/chat\/completions/i.test(url.pathname)) errors.push("接口地址建议使用兼容的 /chat/completions 路径。");
    } catch {
      errors.push("接口地址格式不正确。");
    }
  }
  return errors;
}

// ─── 响应内容标准化 ─────────────────────────────────────────

export function normalizeAiResponseContent(content) {
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      return item?.text || item?.content || item?.value || "";
    }).join("");
  }
  if (content && typeof content === "object") {
    return content.text || content.content || content.value || JSON.stringify(content);
  }
  return String(content || "");
}

// ─── 流式读取 ───────────────────────────────────────────────

export async function readAiChatCompletionStream(response, onProgress) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("当前浏览器无法读取 AI 流式响应，请升级浏览器后重试。");
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let lastProgressAt = 0;

  const consumeFrame = (frame) => {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (payload?.error) throw new Error(payload.error.message || payload.error.code || "模型流式响应失败。");
    const choice = payload?.choices?.[0] || {};
    const delta = choice.delta || choice.message || {};
    content += normalizeAiResponseContent(delta.content || "");
    reasoning += normalizeAiResponseContent(delta.reasoning_content || "");
    const now = Date.now();
    if (typeof onProgress === "function" && now - lastProgressAt >= 500) {
      lastProgressAt = now;
      onProgress({ contentLength: content.length, reasoningLength: reasoning.length });
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    frames.forEach(consumeFrame);
    if (done) break;
  }
  if (buffer.trim()) consumeFrame(buffer);
  const output = (content || reasoning).trim();
  if (!output) throw new Error("模型流式响应结束，但没有生成有效内容。");
  return output;
}

// ─── 多轮对话管理 ─────────────────────────────────────────────

/**
 * 对话历史管理器 — 支持多轮对话上下文维护
 */
export class ConversationManager {
  constructor(options = {}) {
    this.systemPrompt = options.systemPrompt || "";
    this.maxTurns = options.maxTurns || 20;
    this.messages = [];
    if (this.systemPrompt) {
      this.messages.push({ role: "system", content: this.systemPrompt });
    }
  }

  /** 添加用户消息 */
  addUserMessage(content) {
    this.messages.push({ role: "user", content });
    this._trim();
    return this;
  }

  /** 添加助手回复 */
  addAssistantMessage(content) {
    this.messages.push({ role: "assistant", content });
    this._trim();
    return this;
  }

  /** 获取当前对话消息列表 */
  getMessages() {
    return [...this.messages];
  }

  /** 清空对话（保留 system prompt） */
  clear() {
    this.messages = this.systemPrompt
      ? [{ role: "system", content: this.systemPrompt }]
      : [];
    return this;
  }

  /** 获取对话轮数 */
  get turnCount() {
    return this.messages.filter((m) => m.role === "user").length;
  }

  /** 修剪历史，保留 system + 最近 N 轮 */
  _trim() {
    const system = this.messages.filter((m) => m.role === "system");
    const nonSystem = this.messages.filter((m) => m.role !== "system");
    const maxMessages = this.maxTurns * 2; // user + assistant per turn
    if (nonSystem.length > maxMessages) {
      this.messages = [...system, ...nonSystem.slice(-maxMessages)];
    }
  }
}

// ─── 核心调用 ───────────────────────────────────────────────

/** 最近一次 AI 调用后端实际使用的模型名 */
export let lastAiActualModel = "";

/**
 * 调用 AI Chat Completion 接口
 * @param {object} settings - AI 设置 { provider, model, url, apiKey }
 * @param {Array<{role: string, content: string}>} messages - 对话消息
 * @param {object} options - { temperature, maxTokens, stream, responseFormat, timeoutMs, onProgress }
 * @returns {Promise<string>} 模型输出文本
 */
export async function callAiChatCompletion(settings, messages, options = {}) {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    throw new Error("AI 后端代理需要通过本地服务或线上地址访问，不能直接用 file:// 页面调用。请使用 npm run dev 打开本地服务，或访问已部署的网址。");
  }
  // Phase 2: 默认启用流式输出，除非显式关闭
  const useStream = options.stream !== false;
  const requestBody = {
    model: settings.model,
    messages,
    temperature: options.temperature ?? 0.35,
    max_tokens: options.maxTokens ?? 3500
  };
  if (options.responseFormat === "json_object") {
    requestBody.response_format = { type: "json_object" };
  }
  if (useStream) requestBody.stream = true;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 360000;
  const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch("./api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: settings.provider,
      url: settings.url,
      apiKey: settings.apiKey,
      body: requestBody
    }),
    signal: controller.signal
  }).catch((error) => {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      throw new Error("AI 请求超时（" + timeoutSeconds + "秒），可能因数据量过大或模型响应缓慢。已为当前生成阶段启用安全降级。");
    }
    throw new Error(`AI 后端代理连接失败：${error.message}`);
  });

  if (response.ok && useStream && response.body) {
    lastAiActualModel = response.headers.get("X-Actual-Model") || "";
    try {
      return await readAiChatCompletionStream(response, options.onProgress);
    } finally {
      clearTimeout(timeout);
    }
  }
  clearTimeout(timeout);

  if ([404, 405].includes(response.status)) {
    throw new Error("当前环境没有启用 AI 后端代理，请通过 npm run dev 本地服务或 Cloudflare Pages Functions 部署后再调用。");
  }

  lastAiActualModel = response.headers.get("X-Actual-Model") || "";
  const payload = await response.json().catch(() => ({}));
  if (payload?.error) {
    const message = payload.error.message || payload.error.code || JSON.stringify(payload.error);
    throw new Error(message);
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `接口返回 ${response.status}`;
    throw new Error(message);
  }
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};
  const content = normalizeAiResponseContent(
    message.content ||
    message.reasoning_content ||
    choice.text ||
    choice.delta?.content ||
    payload.output_text ||
    payload.response ||
    payload.content ||
    ""
  );
  if (!content.trim()) {
    const preview = JSON.stringify(payload).slice(0, 240);
    throw new Error(`接口返回为空，请检查模型名称或供应商配置。返回摘要：${preview || "无内容"}`);
  }
  return content.trim();
}
