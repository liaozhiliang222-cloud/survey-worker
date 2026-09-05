import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/api/ai.js", import.meta.url), "utf8");
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
let mode = "normal";
let calls = [];

if (!source.includes("TASK_TIER_REQUEST_BUDGET_MS") || !source.includes("break providerLoop")) {
  throw new Error("Cloudflare request budget guard is missing");
}

globalThis.fetch = async (url, options) => {
  if (mode === "abort") {
    const error = new Error("upstream timeout");
    error.name = "AbortError";
    throw error;
  }
  const body = JSON.parse(options.body);
  calls.push({ url, options, body });
  const gatewayCalls = calls.filter((call) => String(call.url).includes("api.surveykit.cc")).length;
  if (mode === "gateway-quota-once" && String(url).includes("api.surveykit.cc") && gatewayCalls === 1) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota." } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "gateway-down" && String(url).includes("api.surveykit.cc")) {
    return new Response(JSON.stringify({ error: { message: "You exceeded your current quota." } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "gateway-quota-content" && String(url).includes("api.surveykit.cc")) {
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Free quota exhausted. Please disable the "use free tier only" mode.' } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (mode === "network" && body.model === "deepseek-v4-pro") throw new TypeError("socket reset");
  if (mode === "quota" && body.model === "deepseek-v4-pro") {
    return new Response(JSON.stringify({ error: { code: "AllocationQuota.FreeTierOnly" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const isChannelProbe = body.messages?.some((message) => String(message.content || "").includes("channel-health-probe"));
  if (mode === "channel-probe" && isChannelProbe) {
    const response = () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    if (String(url).includes("api.surveykit.cc")) {
      return new Promise((resolve) => setTimeout(() => resolve(response()), 40));
    }
    return response();
  }  if (body.stream) {
    return new Response('data: {"choices":[{"delta":{"content":"stream-ok"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  const content = mode === "structured" && /^deepseek-v4-/.test(body.model)
    ? "这是说明文字，不是 JSON"
    : '{"ok":true}';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function makeRequest({ apiKey = "", structured = false, stream = false, taskTier, rotationKey = "k0" } = {}) {
  return new Request("https://surveykit.cc/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": "test-request-id", "X-AI-Rotation-Key": rotationKey },
    body: JSON.stringify({
      provider: "deepseek",
      url: "https://api.deepseek.com/v1/chat/completions",
      apiKey,
      ...(taskTier ? { taskTier } : {}),
      body: {
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
        ...(structured ? { response_format: { type: "json_object" } } : {}),
        ...(stream ? { stream: true } : {}),
      },
    }),
  });
}

// 普通平台请求优先使用 DeepSeek。
calls = [];
mode = "normal";
let response = await mod.onRequest({
  request: makeRequest(),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200) throw new Error(`builtin status ${response.status}`);
if (calls[0].url !== "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions") throw new Error("wrong builtin url");
if (calls[0].body.model !== "deepseek-v4-pro") throw new Error("DeepSeek Pro is not the primary model");
if (calls[0].options.headers.Authorization !== "Bearer server-secret") throw new Error("wrong builtin auth");
if (response.headers.get("X-Actual-Model") !== "deepseek-v4-pro") throw new Error("wrong primary model header");

// Agent Plan is the preferred built-in route whenever its dedicated key is configured.
calls = [];
response = await mod.onRequest({
  request: makeRequest({ taskTier: "quality" }),
  env: {
    VOLCENGINE_AGENT_PLAN_API_KEY: "ark-plan-secret",
    DASHSCOPE_API_KEY: "server-secret",
  },
});
if (calls[0].url !== "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions") throw new Error("wrong Agent Plan URL");
if (calls[0].body.model !== "glm-5.3-flash") throw new Error("GLM 5.3 Flash is not the Agent Plan default");
if (calls[0].options.headers.Authorization !== "Bearer ark-plan-secret") throw new Error("wrong Agent Plan auth");
if (response.headers.get("X-AI-Source") !== "builtin-volcengine-agent-plan") throw new Error("Agent Plan was not selected first");

// Quality tasks skip Flash-only providers and reach DeepSeek Pro first.
calls = [];
response = await mod.onRequest({
  request: makeRequest({ taskTier: "quality" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
    DASHSCOPE_API_KEY: "server-secret",
  },
});
if (calls[0].body.model !== "deepseek-v4-pro" || response.headers.get("X-AI-Source") !== "builtin-bailian") {
  throw new Error("quality routing did not select DeepSeek Pro");
}
if (response.headers.get("X-AI-Task-Tier") !== "quality") throw new Error("quality tier header missing");

// Fast tasks keep the low-latency SurveyKit Flash route first.
calls = [];
response = await mod.onRequest({
  request: makeRequest({ taskTier: "fast" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
    DASHSCOPE_API_KEY: "server-secret",
  },
});
if (calls[0].body.model !== "deepseek-v4-flash" || response.headers.get("X-AI-Source") !== "builtin-surveykit-gateway") {
  throw new Error("fast routing did not select DeepSeek Flash");
}
if (response.headers.get("X-AI-Task-Tier") !== "fast") throw new Error("fast tier header missing");
if (response.headers.get("X-AI-Request-ID") !== "test-request-id") throw new Error("request ID header missing");
if (!/^\d+$/.test(response.headers.get("X-AI-Duration-Ms") || "")) throw new Error("duration header missing");
if (!response.headers.get("X-AI-Rotation")) throw new Error("rotation header missing");
if (!response.headers.get("X-AI-Attempt-Sources")) throw new Error("attempt source header missing");

// Equivalent Flash channels rotate deterministically without changing the model tier.
calls = [];
response = await mod.onRequest({
  request: makeRequest({ taskTier: "fast", rotationKey: "gateway-key" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
  },
});
if (response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("deterministic channel rotation did not change the Flash start channel");
}

// Storyline tasks bypass the unstable gateway and use SenseNova Flash first.
calls = [];
response = await mod.onRequest({
  request: makeRequest({ taskTier: "storyline", rotationKey: "gateway-key" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
  },
});
if (calls[0].body.model !== "deepseek-v4-flash" || response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("storyline routing did not select SenseNova Flash first");
}
if (response.headers.get("X-AI-Task-Tier") !== "storyline") throw new Error("storyline tier header missing");

// The SurveyKit New API gateway takes precedence and keeps Flash as the only default attempt.
calls = [];
mode = "normal";
response = await mod.onRequest({
  request: makeRequest(),
  env: { SURVEYKIT_GATEWAY_API_KEY: "gateway-secret", SENSENOVA_API_KEY: "sense-secret" },
});
if (response.status !== 200) throw new Error("SurveyKit gateway status " + response.status);
if (calls[0].url !== "http://api.surveykit.cc/v1/chat/completions") throw new Error("wrong SurveyKit gateway URL");
if (calls[0].body.model !== "deepseek-v4-flash") throw new Error("SurveyKit gateway Flash is not the default model");
if (calls[0].options.headers.Authorization !== "Bearer gateway-secret") throw new Error("wrong SurveyKit gateway auth");
if (response.headers.get("X-AI-Source") !== "builtin-surveykit-gateway") throw new Error("wrong SurveyKit gateway source");
if (response.headers.get("X-AI-Attempts") !== "deepseek-v4-flash") throw new Error("SurveyKit gateway should use one model attempt");

// A failed channel is skipped immediately before retrying the same pooled model.
calls = [];
mode = "gateway-quota-once";
response = await mod.onRequest({
  request: makeRequest(),
  env: { SURVEYKIT_GATEWAY_API_KEY: "gateway-secret", SENSENOVA_API_KEY: "sense-secret" },
});
if (response.status !== 200 || response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("Failed channel was not skipped");
}
if (calls.length !== 2 || response.headers.get("X-AI-Attempts") !== "deepseek-v4-flash,deepseek-v4-flash") {
  throw new Error("Failed channel did not continue to the equivalent provider");
}

// Exhausted Gateway retries continue to the configured SenseNova provider.
calls = [];
mode = "gateway-down";
response = await mod.onRequest({
  request: makeRequest(),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
    DASHSCOPE_API_KEY: "server-secret",
  },
});
if (response.status !== 200 || response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("Cross-provider fallback failed");
}
if (calls.length !== 2 || calls[1].url !== "https://token.sensenova.cn/v1/chat/completions") {
  throw new Error("Gateway failure did not fast-skip to SenseNova");
}
// Some compatible gateways wrap quota failures in a successful assistant response.
calls = [];
mode = "gateway-quota-content";
response = await mod.onRequest({
  request: makeRequest({ taskTier: "fast" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
  },
});
if (response.status !== 200 || response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("Assistant-content quota fallback failed");
}
if (calls.length !== 2 || !calls[1].url.includes("sensenova.cn")) {
  throw new Error("Assistant-content quota response did not continue to SenseNova");
}
mode = "normal";

// SenseNova takes precedence when its production secret is configured.
calls = [];
mode = "normal";
response = await mod.onRequest({
  request: makeRequest(),
  env: { SENSENOVA_API_KEY: "sense-secret" },
});
if (response.status !== 200) throw new Error("SenseNova status " + response.status);
if (calls[0].url !== "https://token.sensenova.cn/v1/chat/completions") throw new Error("wrong SenseNova URL");
if (calls[0].body.model !== "deepseek-v4-flash") throw new Error("SenseNova Flash is not the default model");
if (calls[0].options.headers.Authorization !== "Bearer sense-secret") throw new Error("wrong SenseNova auth");
if (response.headers.get("X-AI-Source") !== "builtin-sensenova") throw new Error("wrong SenseNova source");
if (response.headers.get("X-AI-Attempts") !== "deepseek-v4-flash") throw new Error("SenseNova should use one model attempt");

// A generic probe selects the faster channel; the full report payload is sent only once.
calls = [];
mode = "channel-probe";
response = await mod.onRequest({
  request: makeRequest({ structured: true, taskTier: "structured" }),
  env: {
    SURVEYKIT_GATEWAY_API_KEY: "gateway-secret",
    SENSENOVA_API_KEY: "sense-secret",
    DASHSCOPE_API_KEY: "server-secret",
  },
});
if (response.status !== 200 || response.headers.get("X-AI-Source") !== "builtin-sensenova") {
  throw new Error("structured channel probe did not select the faster provider");
}
const probeCalls = calls.filter((call) => call.body.messages.some((message) => String(message.content || "").includes("channel-health-probe")));
const reportCalls = calls.filter((call) => !call.body.messages.some((message) => String(message.content || "").includes("channel-health-probe")));
if (probeCalls.length !== 2 || reportCalls.length !== 1 || !reportCalls[0].url.includes("sensenova.cn")) {
  throw new Error("full structured payload was not isolated to the probe winner");
}
// Report frameworks use a dedicated non-streaming structured route: Flash first, then native-JSON fallback.
calls = [];
mode = "structured";
response = await mod.onRequest({
  request: makeRequest({ structured: true, taskTier: "structured" }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "qwen3.7-max") throw new Error("structured tier fallback failed");
if (response.headers.get("X-AI-Task-Tier") !== "structured") throw new Error("structured tier header missing");
if (calls.length !== 2 || calls[0].body.model !== "deepseek-v4-flash" || calls[1].body.model !== "qwen3.7-max") {
  throw new Error("structured tier did not skip unavailable Pro and validate Flash before Qwen");
}
// DeepSeek 不支持严格结构化输出；输出不合规时自动切到 Qwen。
calls = [];
mode = "structured";
response = await mod.onRequest({
  request: makeRequest({ structured: true }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "qwen3.7-max") throw new Error("structured fallback failed");
if (calls.length !== 3) throw new Error("structured request did not traverse both DeepSeek tiers before Qwen");
if (calls[0].body.response_format) throw new Error("unsupported DeepSeek response_format was not removed");
if (calls[1].body.response_format) throw new Error("DeepSeek Flash received unsupported response_format");
if (calls[2].body.response_format?.type !== "json_object") throw new Error("Qwen Max did not receive response_format");

// 免费额度或权限错误时自动切换后备模型。
calls = [];
mode = "quota";
response = await mod.onRequest({
  request: makeRequest(),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "deepseek-v4-flash") throw new Error("quota fallback failed");

// 用户 Key 始终优先，且不进入平台模型链。
calls = [];
mode = "network";
response = await mod.onRequest({
  request: makeRequest(),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "deepseek-v4-flash") throw new Error("network fallback failed");
if (calls.length !== 2 || !calls[0].options.signal) throw new Error("network fallback did not preserve timeout signal");

calls = [];
mode = "normal";
response = await mod.onRequest({
  request: makeRequest({ stream: true }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || !String(response.headers.get("Content-Type")).includes("text/event-stream")) throw new Error("stream passthrough headers failed");
if (!(await response.text()).includes("stream-ok") || !calls[0].options.signal) throw new Error("stream passthrough body failed");

calls = [];
mode = "normal";
response = await mod.onRequest({
  request: makeRequest({ apiKey: "user-secret" }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || calls[0].url !== "https://api.deepseek.com/v1/chat/completions") throw new Error("user key route failed");
if (calls[0].options.headers.Authorization !== "Bearer user-secret") throw new Error("user key precedence failed");

calls = [];
mode = "abort";
response = await mod.onRequest({
  request: makeRequest({ apiKey: "user-secret", structured: true, taskTier: "structured" }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 504) throw new Error(`expected bounded user-key timeout, got ${response.status}`);
mode = "normal";

response = await mod.onRequest({
  request: new Request("https://surveykit.cc/api/ai", { method: "GET", headers: { "X-Request-ID": "health-request-id" } }),
  env: { SURVEYKIT_GATEWAY_API_KEY: "gateway-secret", SENSENOVA_API_KEY: "sense-secret" },
});
const health = await response.json();
if (response.status !== 200 || health.rotation_mode !== "deterministic" || health.configured_sources.length !== 2) {
  throw new Error("AI proxy health response is incomplete");
}

response = await mod.onRequest({ request: makeRequest(), env: {} });
if (response.status !== 503) throw new Error(`expected 503, got ${response.status}`);

console.log("AI proxy tests passed: task tiers, deterministic rotation, fast failure skip, tracing, health and compatibility");
