import process from "node:process";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = readArg("base-url", process.env.SURVEYKIT_BASE_URL || "http://127.0.0.1:4281")
  .replace(/\/+$/, "");
const expectedRelease = readArg("release", process.env.SURVEYKIT_EXPECTED_RELEASE || "");
const timeoutMs = Math.max(1_000, Number(readArg("timeout-ms", "20000")) || 20_000);

async function check(path, validate) {
  const startedAt = Date.now();
  try {
    const response = await fetch(baseUrl + path, {
      headers: { Accept: "application/json", "X-Request-ID": `release-check-${Date.now()}` },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const payload = await response.json().catch(() => null);
    const validation = payload && typeof payload === "object" ? validate(payload) : "响应不是 JSON";
    const release = payload?.release?.version || payload?.proxy?.release?.version || "";
    const releaseMatches = !expectedRelease || release === expectedRelease;
    return {
      path,
      ok: response.ok && !validation && releaseMatches,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      service: payload?.service || "",
      release,
      error: validation || (!releaseMatches ? `版本不匹配，期望 ${expectedRelease}，实际 ${release || "unknown"}` : ""),
    };
  } catch (error) {
    return {
      path,
      ok: false,
      status: 0,
      duration_ms: Date.now() - startedAt,
      service: "",
      release: "",
      error: error?.message || String(error),
    };
  }
}

const checks = await Promise.all([
  check("/healthz", (payload) => payload.ok === true && payload.service === "surveykit-web" ? "" : "Web 健康契约无效"),
  check("/pptx-api/healthz", (payload) => (
    payload.ok === true
    && payload.service === "pptx-report"
    && payload.proxy?.ok === true
    && (!expectedRelease || payload.proxy?.release?.version === expectedRelease)
  ) ? "" : "PPTX 完整链路健康契约或代理版本无效"),
  check("/api/ai", (payload) => payload.ok === true ? "" : "AI 代理健康契约无效"),
]);

const summary = {
  checked_at: new Date().toISOString(),
  base_url: baseUrl,
  expected_release: expectedRelease,
  checks,
  ok: checks.every((item) => item.ok),
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
