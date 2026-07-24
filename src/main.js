/**
 * 调研工具箱 — 模块化入口
 * Phase 1 过渡策略：
 *   - 共享工具模块已提取为 ES Module（shared/）
 *   - 原有 app.js 作为 legacy 模块整体引入，保持功能完整
 *   - 后续逐步将 app.js 中的功能域迁移到 modules/ 下
 */

// ─── 样式模块 ───────────────────────────────────────────────
import "./styles/index.css";

// ─── 共享模块（已完成提取）───────────────────────────────────
export * as stats from "./shared/stats.js";
export * as fileParser from "./shared/file-parser.js";
export * as exportUtils from "./shared/export.js";
export * as aiClient from "./shared/ai-client.js";
export { state, resetWorkspaceRuntimeState } from "./shared/store.js";
export { showToast, showButtonSaved, setButtonLoading } from "./shared/toast.js";
export {
  loadWorkspaceLibrary,
  persistWorkspaceLibrary,
  loadJson,
  saveJson
} from "./shared/storage.js";

// ─── 功能模块（已完成提取）───────────────────────────────────
export * as workspace from "./modules/workspace/index.js";
export * as sample from "./modules/sample/index.js";
export * as quota from "./modules/quota/index.js";
export * as cleaning from "./modules/cleaning/index.js";
export * as crosstab from "./modules/crosstab/index.js";
export * as psm from "./modules/psm/index.js";
export * as kano from "./modules/kano/index.js";
export * as maxdiff from "./modules/maxdiff/index.js";
export * as aiPlan from "./modules/ai-plan/index.js";
export * as aiQuestionnaire from "./modules/ai-questionnaire/index.js";
export * as aiReport from "./modules/ai-report/index.js";
export * as pptxReport from "./modules/pptx-report/index.js";

// ─── Legacy app.js 兼容层 ───────────────────────────────────
// 在过渡期，app.js 仍以全局函数方式运行（通过 <script> 标签加载）。
// 当所有模块提取完成并验证后，app.js 将被移除。

// ─── 错误监控 ───────────────────────────────────────────────
import { initErrorMonitor } from "./shared/error-monitor.js";

// ─── 应用初始化 ─────────────────────────────────────────────
function initApp() {
  // 初始化错误监控
  initErrorMonitor({ enableConsole: true });

  // 移除加载遮罩
  const overlay = document.querySelector("#appLoading");
  if (overlay) {
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 350);
  }

  // 注册 Service Worker（生产环境）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
