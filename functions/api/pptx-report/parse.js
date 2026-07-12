// /api/pptx-report/parse 代理到阿里云后端
import { proxyToBackend } from "./_proxy.js";

export async function onRequest({ request, env }) {
  return proxyToBackend(request, env);
}
