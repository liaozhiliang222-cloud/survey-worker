import process from "node:process";

function readArg(name, fallback = "") {
  const prefix = "--" + name + "=";
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = readArg("base-url", process.env.AI_PROBE_BASE_URL || "https://surveykit.cc").replace(/\/+$/, "");
const tiers = readArg("tiers", "fast,storyline,quality")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const endpoint = baseUrl + "/api/ai";

async function checkHealth() {
  const response = await fetch(endpoint, {
    headers: { "X-Request-ID": "probe-health-" + Date.now() },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok && body.ok === true,
    status: response.status,
    rotationMode: body.rotation_mode || "",
    sources: Array.isArray(body.configured_sources)
      ? body.configured_sources.map((item) => item.source)
      : [],
  };
}

async function probeTier(taskTier, index) {
  const requestId = "probe-" + taskTier + "-" + Date.now() + "-" + index;
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        "X-AI-Rotation-Key": requestId,
      },
      body: JSON.stringify({
        taskTier,
        body: {
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          temperature: 0,
          max_tokens: 32,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => ({}));
    const content = String(
      payload?.choices?.[0]?.message?.content
      || payload?.choices?.[0]?.message?.reasoning_content
      || payload?.choices?.[0]?.text
      || "",
    ).trim();
    return {
      taskTier,
      ok: response.ok && Boolean(content),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      proxyDurationMs: Number(response.headers.get("x-ai-duration-ms")) || 0,
      requestId: response.headers.get("x-ai-request-id") || requestId,
      source: response.headers.get("x-ai-source") || "",
      model: response.headers.get("x-actual-model") || "",
      rotation: response.headers.get("x-ai-rotation") || "",
      fallbackUsed: response.headers.get("x-ai-fallback-used") === "1",
      errorType: payload?.error?.type || response.headers.get("x-ai-error-type") || "",
    };
  } catch (error) {
    return {
      taskTier,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      requestId,
      errorType: error?.name === "TimeoutError" ? "timeout" : "network",
      message: error?.message || String(error),
    };
  }
}

const health = await checkHealth().catch((error) => ({
  ok: false,
  status: 0,
  rotationMode: "",
  sources: [],
  message: error?.message || String(error),
}));
const results = [];
for (let index = 0; index < tiers.length; index += 1) {
  results.push(await probeTier(tiers[index], index));
}
const summary = {
  checkedAt: new Date().toISOString(),
  endpoint,
  health,
  results,
  ok: health.ok && results.every((item) => item.ok),
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
