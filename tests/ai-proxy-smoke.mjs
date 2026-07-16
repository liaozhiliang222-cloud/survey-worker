import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/api/ai.js", import.meta.url), "utf8");
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
let captured = null;

globalThis.fetch = async (url, options) => {
  captured = { url, options };
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function makeRequest(apiKey = "") {
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
        response_format: { type: "json_object" },
      },
    }),
  });
}

let response = await mod.onRequest({
  request: makeRequest(),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200) throw new Error(`builtin status ${response.status}`);
const builtinBody = JSON.parse(captured.options.body);
if (captured.url !== "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions") throw new Error("wrong builtin url");
if (builtinBody.model !== "qwen-plus") throw new Error("wrong builtin model");
if (captured.options.headers.Authorization !== "Bearer server-secret") throw new Error("wrong builtin auth");
if (response.headers.get("X-AI-Source") !== "builtin-bailian") throw new Error("missing builtin source");

response = await mod.onRequest({
  request: makeRequest("user-secret"),
  env: { DASHSCOPE_API_KEY: "server-secret" },
});
if (response.status !== 200 || captured.url !== "https://api.deepseek.com/v1/chat/completions") throw new Error("user key route failed");
if (captured.options.headers.Authorization !== "Bearer user-secret") throw new Error("user key precedence failed");

response = await mod.onRequest({ request: makeRequest(), env: {} });
if (response.status !== 503) throw new Error(`expected 503, got ${response.status}`);

console.log("AI proxy tests passed: builtin route, user-key precedence, missing-secret guard");
