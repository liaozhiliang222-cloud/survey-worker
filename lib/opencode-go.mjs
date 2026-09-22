// Shared by the local Node server and Cloudflare Pages Functions.
// Credentials are read only from the backend environment (or an explicit user key).
export const GO_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const GO_MODELS = Object.freeze(["deepseek-v4.1-flash", "mimo-v2.6-flash"]);

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "X-Actual-Model, X-AI-Fallback-Reason, X-AI-Source, X-AI-Fallback-Used, X-AI-Request-ID, X-AI-Duration-Ms, X-AI-Task-Tier"
};

function failure(status, message) {
  return Response.json({ error: { message } }, { status, headers });
}

function retryReason(status, text) {
  let type;
  try { type = JSON.parse(text)?.error?.type; } catch {}
  if (status === 403 && type === "RegionError") return "region_opt_in_required";
  if (status === 429) return "rate_limited";
  if ([404, 408, 502, 503, 504].includes(status) || status >= 500) return "model_unavailable";
  return "";
}

// null means this request belongs to a legacy provider, whose existing route handles it.
export async function handleOpenCodeGo(payload, env = {}, fetchImpl = fetch) {
  const userKey = String(payload.apiKey || "").trim();
  const backendKey = String(env.OPENCODE_GO_API_KEY || "").trim();
  if (payload.provider !== "opencode-go" && (userKey || !backendKey)) return null;
  const apiKey = userKey || backendKey;
  if (!apiKey) return failure(503, "后端未配置 OPENCODE_GO_API_KEY，请联系管理员。");
  const input = payload.body;
  if (!input || !input.model || !Array.isArray(input.messages) || !input.messages.length) {
    return failure(400, "Missing model or messages.");
  }
  // Never allow the browser to select an arbitrary endpoint or spend the shared key on other models.
  if (payload.provider === "opencode-go" && !GO_MODELS.includes(input.model)) {
    return failure(400, "OpenCode Go 仅支持 DeepSeek V4.1 Flash 和 MiMo-V2.6-Flash。");
  }
  const preferred = GO_MODELS.includes(input.model) ? input.model : GO_MODELS[0];
  const models = [preferred, ...GO_MODELS.filter(model => model !== preferred)];
  const session = /^[A-Za-z0-9_-]{16,128}$/.test(payload.sessionId || "")
    ? payload.sessionId : globalThis.crypto.randomUUID();
  let fallbackReason = "";
  for (const model of models) {
    const controller = new AbortController();
    // Non-streaming durable jobs have a 90s upstream deadline; leave room for both attempts.
    const timeout = setTimeout(() => controller.abort(), input.stream === true ? 300000 : 38000);
    let handedOff = false;
    try {
      const upstream = await fetchImpl(GO_URL, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "research-toolbox/1.0",
          "x-opencode-session": session
        },
        body: JSON.stringify({
          ...input, model,
          // These are text/report requests. Disable hidden reasoning so short connection
          // tests and bounded report output are not consumed by reasoning-only responses.
          thinking: { type: "disabled" }
        }),
        signal: controller.signal
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return failure(502, "OpenCode Go 返回了非预期重定向，已阻止转发密钥。");
      }
      if (!upstream.ok) {
        const text = await upstream.text();
        fallbackReason = retryReason(upstream.status, text);
        let upstreamType = "";
        try { upstreamType = String(JSON.parse(text)?.error?.type || "").slice(0, 80); } catch {}
        console.warn(JSON.stringify({ event: "opencode_go_attempt", model, status: upstream.status, reason: fallbackReason || "rejected", upstream_type: upstreamType }));
        if (fallbackReason) continue;
        if ([401, 403].includes(upstream.status)) {
          return failure(upstream.status, "OpenCode Go 拒绝了请求，请检查 API Key、订阅及账户访问权限。");
        }
        return failure(upstream.status, `OpenCode Go 请求失败（HTTP ${upstream.status}），请检查请求参数。`);
      }
      const responseHeaders = {
        ...headers,
        "X-Actual-Model": model,
        "X-AI-Source": userKey ? "user-key" : "builtin-opencode-go",
        "X-AI-Fallback-Used": fallbackReason ? "1" : "0",
        ...(fallbackReason ? { "X-AI-Fallback-Reason": fallbackReason } : {})
      };
      if (input.stream === true && upstream.headers.get("content-type")?.includes("text/event-stream") && upstream.body) {
        const reader = upstream.body.getReader();
        const stream = new ReadableStream({
          async pull(output) {
            try {
              const { done, value } = await reader.read();
              if (done) { clearTimeout(timeout); output.close(); }
              else output.enqueue(value);
            } catch (error) { clearTimeout(timeout); output.error(error); }
          },
          async cancel(reason) {
            clearTimeout(timeout);
            controller.abort();
            await reader.cancel(reason);
          }
        });
        handedOff = true;
        return new Response(stream, { headers: {
          ...responseHeaders,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no"
        } });
      }
      const data = await upstream.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        fallbackReason = "empty_response";
        console.warn(JSON.stringify({ event: "opencode_go_attempt", model, reason: fallbackReason }));
        continue;
      }
      if (input.response_format?.type === "json_object") {
        try {
          const parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
        } catch {
          fallbackReason = "invalid_json";
          continue;
        }
      }
      // Some providers return JSON despite stream:true. Preserve the browser's SSE contract.
      if (input.stream === true) {
        const chunk = { choices: [{ delta: { content } }] };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { ...responseHeaders, "Content-Type": "text/event-stream; charset=utf-8" }
        });
      }
      return Response.json(data, { headers: responseHeaders });
    } catch (error) {
      fallbackReason = controller.signal.aborted ? "timeout" : "connection_failed";
      console.warn(JSON.stringify({ event: "opencode_go_attempt", model, reason: fallbackReason, error_name: error?.name, message: String(error?.message || "").replaceAll(apiKey, "[redacted]").slice(0, 300) }));
    } finally {
      if (!handedOff) clearTimeout(timeout);
    }
  }
  return failure(502, "OpenCode Go 两个模型暂时均不可用，请检查订阅额度、地区授权或稍后重试。");
}
