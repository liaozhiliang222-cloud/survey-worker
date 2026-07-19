// Catch-all Cloudflare Pages Function for /pptx-api and /pptx-api/*.
import { proxyToBackend } from "./_proxy.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const backendConfigured = Boolean(String(env?.PPTX_BACKEND_URL || "").trim());
  console.log(`[PPTX Function] ${request.method} ${url.pathname} backend_configured=${backendConfigured}`);

  try {
    const response = await proxyToBackend(request, env);
    console.log(`[PPTX Function] Response status: ${response.status}`);
    return response;
  } catch (error) {
    console.error(`[PPTX Function] Unhandled error: ${error.message}`);
    return new Response(
      JSON.stringify({ error: { message: "PPTX 代理发生未处理错误。" } }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
