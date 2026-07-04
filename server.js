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

http
  .createServer((req, res) => {
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
          const targetUrl = validateAiTarget(payload.provider || "custom", payload.url);
          const apiKey = String(payload.apiKey || "").trim();
          const requestBody = payload.body;
          if (!apiKey || !requestBody || !requestBody.model || !Array.isArray(requestBody.messages)) {
            sendJson(res, 400, { error: { message: "Missing apiKey, model or messages." } });
            return;
          }
          const upstream = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
          });
          const text = await upstream.text();
          res.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
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
