const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4281);
const providerHosts = {
  deepseek: ["api.deepseek.com"],
  kimi: ["api.moonshot.cn"],
  zhipu: ["open.bigmodel.cn"],
  qwen: ["dashscope.aliyuncs.com"],
  openai: ["api.openai.com"]
};
const maxBodyBytes = 1024 * 1024;
const builtinBailianUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const defaultBuiltinModels = ["deepseek-v4-flash", "qwen3.7-plus", "glm-5.2"];
const pptxBackendUrl = String(process.env.PPTX_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function allowedHosts() {
  const extra = (process.env.AI_PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...Object.values(providerHosts).flat(), ...extra]);
}

function validateAiTarget(provider, rawUrl) {
  if (!rawUrl) throw new Error("Missing provider API URL.");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Only HTTPS model APIs are allowed.");
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    throw new Error("Only OpenAI-compatible /chat/completions APIs are supported.");
  }
  const host = url.hostname.toLowerCase();
  const presetHosts = providerHosts[provider] || [];
  if (!allowedHosts().has(host) && !presetHosts.includes(host)) {
    throw new Error(`Model API host is not allowed: ${host}`);
  }
  return url.toString();
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function builtinModels() {
  const configured = String(process.env.BAILIAN_MODELS || process.env.BAILIAN_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : defaultBuiltinModels;
}

function prepareBuiltinBody(body, model) {
  const next = { ...body, model };
  if (/^deepseek-/i.test(model)) delete next.response_format;
  return next;
}

function responseContainsJson(text) {
  try {
    const payload = JSON.parse(text);
    const content = String(payload?.choices?.[0]?.message?.content || "").trim();
    const candidate = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
      || content.match(/\{[\s\S]*\}/)?.[0]
      || content;
    const parsed = JSON.parse(candidate);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

async function requestModel(targetUrl, apiKey, body) {
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  return { upstream, text: await upstream.text() };
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/pptx-api")) {
      const targetPath = req.url.replace(/^\/pptx-api(?:\/|$)/, "/api/pptx-report/");
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 30 * 1024 * 1024) req.destroy();
        else chunks.push(chunk);
      });
      req.on("end", async () => {
        try {
          const headers = { ...req.headers };
          delete headers.host;
          delete headers["content-length"];
          const upstream = await fetch(pptxBackendUrl + targetPath, {
            method: req.method,
            headers,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          const responseHeaders = Object.fromEntries(upstream.headers.entries());
          responseHeaders["access-control-allow-origin"] = "*";
          res.writeHead(upstream.status, responseHeaders);
          res.end(body);
        } catch (error) {
          sendJson(res, 502, { error: { message: `PPTX 后端连接失败：${error.message}` } });
        }
      });
      return;
    }

    if (req.url === "/api/ai" && req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.url === "/api/ai" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body) > maxBodyBytes) {
          req.destroy();
        }
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const clientApiKey = String(payload.apiKey || "").trim();
          const useBuiltin = !clientApiKey;
          const targetUrl = validateAiTarget(
            useBuiltin ? "qwen" : (payload.provider || "custom"),
            useBuiltin ? (process.env.BAILIAN_API_URL || builtinBailianUrl) : payload.url
          );
          const apiKey = useBuiltin
            ? String(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.AI_API_KEY || "").trim()
            : clientApiKey;
          const requestBody = payload.body;
          if (!requestBody || !requestBody.model || !Array.isArray(requestBody.messages)) {
            sendJson(res, 400, { error: { message: "Missing model or messages." } });
            return;
          }
          if (!apiKey) {
            sendJson(res, 503, { error: { message: "Built-in Bailian service is not configured." } });
            return;
          }
          const wantsJson = requestBody.response_format?.type === "json_object";
          const models = useBuiltin ? builtinModels() : [requestBody.model];
          const attempts = [];
          let result = null;
          let actualModel = requestBody.model;
          for (const model of models) {
            attempts.push(model);
            const upstreamBody = useBuiltin ? prepareBuiltinBody(requestBody, model) : requestBody;
            result = await requestModel(targetUrl, apiKey, upstreamBody);
            actualModel = model;
            if (!result.upstream.ok || !result.text.trim()) continue;
            if (useBuiltin && wantsJson && !responseContainsJson(result.text)) continue;
            break;
          }
          const upstream = result.upstream;
          const text = result.text;
          if (!text.trim()) {
            sendJson(res, upstream.ok ? 502 : upstream.status, {
              error: {
                message: `Upstream returned empty response from ${new URL(targetUrl).hostname}. Please check model name, API key, account quota or provider status.`
              }
            });
            return;
          }
          res.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "X-Actual-Model": upstream.headers.get("X-Actual-Model") || actualModel,
            "X-AI-Source": useBuiltin ? "builtin-bailian" : "user-key",
            "X-AI-Attempts": attempts.join(",")
          });
          res.end(text);
        } catch (error) {
          const message = error.message || "AI proxy request failed.";
          const status = /missing|only|not allowed|invalid/i.test(message) ? 400 : 500;
          sendJson(res, status, { error: { message } });
        }
      });
      return;
    }

    const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.resolve(root, `.${requestedPath}`);

    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(content);
    });
  })
  .listen(port, () => {
    console.log(`Research toolbox running at http://localhost:${port}`);
  });
