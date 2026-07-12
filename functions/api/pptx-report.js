// /api/pptx-report 及其所有子路径（/api/pptx-report、/api/pptx-report/parse、/api/pptx-report/preview）
// 统一代理到阿里云后端 FastAPI 服务
import { proxyToBackend } from "./pptx-report/_proxy.js";

export async function onRequest({ request, env }) {
  return proxyToBackend(request, env);
}
