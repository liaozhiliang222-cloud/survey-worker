const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4281);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

http
  .createServer((req, res) => {
    if (req.url === "/api/ai" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const targetUrl = payload.url;
          const apiKey = payload.apiKey;
          const requestBody = payload.body;
          if (!targetUrl || !apiKey || !requestBody) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: { message: "Missing url, apiKey or body" } }));
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
            "Access-Control-Allow-Origin": "*"
          });
          res.end(text);
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: { message: error.message } }));
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
