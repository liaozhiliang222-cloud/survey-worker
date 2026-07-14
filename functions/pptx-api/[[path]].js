// Catch-all route for /api/pptx-report and /api/pptx-report/*
// Keeping one Pages Function avoids file/folder route conflicts during deployment.
import { proxyToBackend } from "./_proxy.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  console.log(`[PPTX Function] ${request.method} ${url.pathname}`);
  console.log(`[PPTX Function] Backend URL: ${env.PPTX_BACKEND_URL || 'http://ppt-api.surveykit.cc'}`);
  
  try {
    const response = await proxyToBackend(request, env);
    console.log(`[PPTX Function] Response status: ${response.status}`);
    return response;
  } catch (error) {
    console.error(`[PPTX Function] Error: ${error.message}`);
    return new Response(
      JSON.stringify({ 
        error: { 
          message: `Function error: ${error.message}`,
          stack: error.stack 
        } 
      }),
      { 
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      }
    );
  }
}
