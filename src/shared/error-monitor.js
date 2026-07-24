/**
 * 错误监控模块 — 轻量级前端错误捕获与上报
 * Phase 3.4: 捕获未处理异常、Promise 拒绝、资源加载失败
 */

import { state } from "./store.js";

const ERROR_LOG_KEY = "surveykit_error_log";
const MAX_LOG_SIZE = 50;

/** @type {Array<{time: string, type: string, message: string, stack?: string, url?: string}>} */
let errorLog = [];

/**
 * 初始化错误监控
 * @param {object} options - { reportUrl, enableConsole, maxLogSize }
 */
export function initErrorMonitor(options = {}) {
  const {
    reportUrl = "",
    enableConsole = true,
    maxLogSize = MAX_LOG_SIZE
  } = options;

  // 加载历史错误日志
  try {
    errorLog = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || "[]");
  } catch {
    errorLog = [];
  }

  // 全局未捕获异常
  window.addEventListener("error", (event) => {
    captureError({
      type: "uncaught_error",
      message: event.message || "Unknown error",
      stack: event.error?.stack || "",
      url: `${event.filename}:${event.lineno}:${event.colno}`
    }, { reportUrl, enableConsole, maxLogSize });
  });

  // 未处理的 Promise 拒绝
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    captureError({
      type: "unhandled_rejection",
      message: reason?.message || String(reason) || "Unhandled promise rejection",
      stack: reason?.stack || ""
    }, { reportUrl, enableConsole, maxLogSize });
  });

  // 资源加载失败（脚本、样式）
  document.addEventListener("error", (event) => {
    const target = event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      captureError({
        type: "resource_load_error",
        message: `Failed to load: ${target.src || target.href || "unknown"}`,
        url: target.src || target.href || ""
      }, { reportUrl, enableConsole, maxLogSize });
    }
  }, true);

  if (enableConsole) {
    console.info("[ErrorMonitor] 错误监控已启用");
  }
}

/**
 * 捕获并记录错误
 */
function captureError(errorInfo, options = {}) {
  const { reportUrl = "", enableConsole = true, maxLogSize = MAX_LOG_SIZE } = options;
  const entry = {
    time: new Date().toISOString(),
    type: errorInfo.type,
    message: String(errorInfo.message).slice(0, 500),
    stack: String(errorInfo.stack || "").slice(0, 1000),
    url: errorInfo.url || "",
    userAgent: navigator.userAgent,
    pageUrl: location.href
  };

  errorLog.unshift(entry);
  if (errorLog.length > maxLogSize) {
    errorLog = errorLog.slice(0, maxLogSize);
  }

  // 持久化
  try {
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(errorLog));
  } catch {
    // 存储空间不足时忽略
  }

  // 控制台输出
  if (enableConsole) {
    console.warn(`[ErrorMonitor][${entry.type}] ${entry.message}`, entry);
  }

  // 上报（如果配置了 reportUrl）
  if (reportUrl) {
    reportError(reportUrl, entry);
  }
}

/**
 * 上报错误到后端
 */
function reportError(reportUrl, entry) {
  try {
    navigator.sendBeacon(reportUrl, JSON.stringify({
      errors: [entry],
      timestamp: Date.now()
    }));
  } catch {
    // sendBeacon 失败时静默忽略
  }
}

/**
 * 手动记录错误（供业务代码调用）
 * @param {string} message - 错误描述
 * @param {object} context - 附加上下文
 */
export function logError(message, context = {}) {
  captureError({
    type: "manual",
    message,
    stack: context.stack || new Error().stack || "",
    url: context.url || ""
  }, { enableConsole: false });
}

/**
 * 获取错误日志
 * @returns {Array} 错误记录列表
 */
export function getErrorLog() {
  return [...errorLog];
}

/**
 * 清空错误日志
 */
export function clearErrorLog() {
  errorLog = [];
  try {
    localStorage.removeItem(ERROR_LOG_KEY);
  } catch {
    // ignore
  }
}

/**
 * 获取错误统计摘要
 */
export function getErrorSummary() {
  const byType = {};
  const last24h = errorLog.filter((e) => Date.now() - new Date(e.time).getTime() < 86400000);
  errorLog.forEach((e) => {
    byType[e.type] = (byType[e.type] || 0) + 1;
  });
  return {
    total: errorLog.length,
    last24h: last24h.length,
    byType,
    lastError: errorLog[0] || null
  };
}
