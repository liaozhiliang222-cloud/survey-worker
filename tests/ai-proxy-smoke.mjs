import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/api/ai.js", import.meta.url), "utf8");
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
let mode = "normal";
let calls = [];

globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url, options, body });
  if (mode === "quota" && body.model === "deepseek-v4-flash") {
    return new Response(JSON.stringify({ error: { code: "AllocationQuota.FreeTierOnly" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const content = mode === "structured" && body.model === "deepseek-v4-flash"
    ? "这是说明文字，不是 JSON"
    : '{"ok":true}';
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function makeRequest({ apiKey = "", structured = false } = {}) {
  return new Request("https://surveykit.cc/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "deepseek",
      url: "https://api.deepseek.com/v1/chat/completions",
      apiKey,
      body: {
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
        ...(structured ? { response_format: { type: "json_object" } } : {}),
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
if (calls[0].body.model !== "deepseek-v4-flash") throw new Error("DeepSeek is not the primary model");
if (calls[0].options.headers.Authorization !== "Bearer server-secret") throw new Error("wrong builtin auth");
if (response.headers.get("X-Actual-Model") !== "deepseek-v4-flash") throw new Error("wrong primary model header");

// DeepSeek 不支持严格结构化输出；输出不合规时自动切到 Qwen。
calls = [];
mode = "structured";
response = await mod.onRequest({
  request: makeRequest({ structured: true }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "qwen3.7-plus") throw new Error("structured fallback failed");
if (calls.length !== 2) throw new Error("structured request did not fall back exactly once");
if (calls[0].body.response_format) throw new Error("unsupported DeepSeek response_format was not removed");
if (calls[1].body.response_format?.type !== "json_object") throw new Error("Qwen did not receive response_format");

// 免费额度或权限错误时自动切换后备模型。
calls = [];
mode = "quota";
response = await mod.onRequest({
  request: makeRequest(),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || response.headers.get("X-Actual-Model") !== "qwen3.7-plus") throw new Error("quota fallback failed");

// 用户 Key 始终优先，且不进入平台模型链。
calls = [];
mode = "normal";
response = await mod.onRequest({
  request: makeRequest({ apiKey: "user-secret" }),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || calls[0].url !== "https://api.deepseek.com/v1/chat/completions") throw new Error("user key route failed");
if (calls[0].options.headers.Authorization !== "Bearer user-secret") throw new Error("user key precedence failed");

response = await mod.onRequest({ request: makeRequest(), env: {} });
if (response.status !== 503) throw new Error(`expected 503, got ${response.status}`);

console.log("AI proxy tests passed: DeepSeek primary, structured/quota fallback, user-key precedence, missing-secret guard");
