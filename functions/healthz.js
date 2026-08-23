function releaseInfo(env = {}) {
  return {
    version: String(env.SURVEYKIT_RELEASE || "unknown"),
    revision: String(env.SURVEYKIT_COMMIT || env.CF_PAGES_COMMIT_SHA || ""),
    deployed_at: String(env.SURVEYKIT_DEPLOYED_AT || ""),
  };
}

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    service: "surveykit-web",
    runtime: "cloudflare-pages",
    release: releaseInfo(env),
    dependencies: {
      pptx_backend_configured: Boolean(String(env?.PPTX_BACKEND_URL || "").trim()),
      ai_proxy_configured: Boolean(
        String(env?.SURVEYKIT_API_KEY || "").trim()
        || String(env?.SENSENOVA_API_KEY || "").trim()
        || String(env?.DASHSCOPE_API_KEY || env?.BAILIAN_API_KEY || "").trim()
      ),
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-SurveyKit-Service": "surveykit-web",
      "X-SurveyKit-Release": String(env?.SURVEYKIT_RELEASE || "unknown"),
    },
  });
}
