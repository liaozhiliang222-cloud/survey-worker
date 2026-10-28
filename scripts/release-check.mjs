import process from "node:process";
import { accessServiceHeaders, isAccessLoginRedirect } from "./lib/research-access.mjs";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = readArg("base-url", process.env.SURVEYKIT_BASE_URL || "http://127.0.0.1:4281")
  .replace(/\/+$/, "");
const expectedRelease = readArg("release", process.env.SURVEYKIT_EXPECTED_RELEASE || "");
const expectedRevision = readArg("revision", process.env.SURVEYKIT_EXPECTED_REVISION || "");
const timeoutMs = Math.max(1_000, Number(readArg("timeout-ms", "20000")) || 20_000);

async function check(path, validate, { verifyRelease = true } = {}) {
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
    const releaseMatches = !verifyRelease || !expectedRelease || release === expectedRelease;
    const revision = payload?.release?.revision || "";
    const revisionMatches = !verifyRelease || !expectedRevision || (revision === expectedRevision
      && (!payload?.proxy || payload.proxy.release?.revision === expectedRevision));
    return {
      path,
      ok: response.ok && !validation && releaseMatches && revisionMatches,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      service: payload?.service || "",
      release,
      revision,
      error: validation || (!releaseMatches ? `版本不匹配，期望 ${expectedRelease}，实际 ${release || "unknown"}` : "")
        || (!revisionMatches ? `Git revision 不匹配，期望 ${expectedRevision}` : ""),
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

async function checkResearchAccess() {
  const path = "/api/research/projects";
  const startedAt = Date.now();
  let status = 0;
  try {
    const credentials = accessServiceHeaders();
    const response = await fetch(baseUrl + path, {
      redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    const protectedByAccess = isAccessLoginRedirect(response);
    // Do not read or log customer projects if the protection has regressed.
    await response.body?.cancel();
    if (!protectedByAccess) throw new Error(`匿名研究员接口未跳转到 Access 登录页（HTTP ${status}），可能存在数据暴露或配置错误。`);
    if (Object.keys(credentials).length) {
      const authenticated = await fetch(baseUrl + path, {
        headers: { ...credentials, Accept: "application/json" },
        redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await authenticated.json().catch(() => null);
      if (!authenticated.ok || !Array.isArray(payload?.projects)) {
        throw new Error(`服务凭据检查失败（HTTP ${authenticated.status}），请核对 Service Auth 策略、D1 和身份绑定。`);
      }
    }
    return { path, ok: true, status, duration_ms: Date.now() - startedAt,
      service: "cloudflare-access", authenticated_checked: Object.keys(credentials).length > 0, error: "" };
  } catch (error) {
    return { path, ok: false, status, duration_ms: Date.now() - startedAt, error: error.message };
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
  checkResearchAccess(),
]);

const summary = {
  checked_at: new Date().toISOString(),
  base_url: baseUrl,
  expected_release: expectedRelease,
  expected_revision: expectedRevision,
  checks,
  ok: checks.every((item) => item.ok),
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
