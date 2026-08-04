/**
 * 用户分群分析 — 本地聚类 Web Worker
 *
 * 在浏览器后台线程执行 K-Means / 两步聚类 / 系统聚类，
 * 避免大数据量计算阻塞主线程。所有计算均在本地完成，
 * 不发送任何原始数据到服务器，也不调用任何 AI 接口。
 *
 * 协议：
 *   postMessage({ type: "cluster_run", requestId, payload })  请求
 *   postMessage({ type: "cluster_progress", requestId, progress, stage, message })
 *   postMessage({ type: "cluster_done", requestId, result })
 *   postMessage({ type: "cluster_error", requestId, errorCode, message, details })
 *   主线程可发送 { type: "cluster_cancel", requestId } 取消任务
 */
importScripts("./cluster-core.js");

const core = self.ClusterCore;
if (!core) {
  self.postMessage({ type: "cluster_error", requestId: "", errorCode: "core_missing", message: "聚类算法核心加载失败（cluster-core.js 缺失）。" });
}

let currentRequestId = null;
let cancelled = false;

function postProgress(requestId, progress, stage, message) {
  self.postMessage({ type: "cluster_progress", requestId, progress, stage, message });
}

function stageText(stage) {
  return {
    prepare: "数据准备",
    preprocess: "变量预处理",
    quality: "质量检查",
    cluster: "聚类计算",
    profile: "群体画像",
    export: "结果整理"
  }[stage] || stage;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runCluster(payload, requestId) {
  const { method, rows, variableDefinitions, profileVariables, idColumn, weightColumn, preprocessing, methodOptions } = payload || {};

  postProgress(requestId, 0.05, "prepare", "正在准备数据");
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("没有可用的数据行，请先导入数据。");
  }
  const definitions = Array.isArray(variableDefinitions) ? variableDefinitions : [];
  const clusterVariables = definitions.filter((definition) => definition.role === "cluster").map((definition) => definition.name);
  if (clusterVariables.length < 2) {
    throw new Error("至少需要选择 2 个聚类变量。");
  }

  postProgress(requestId, 0.15, "quality", "正在执行数据质量检查");
  await yieldToEventLoop();
  const qualityChecks = core.runQualityChecks({
    rows,
    definitions,
    clusterVariables,
    weightVariable: weightColumn || ""
  });
  const blockingIssues = qualityChecks.filter((issue) => issue.level === "block");
  if (blockingIssues.length) {
    throw new Error(`数据质量检查未通过：${blockingIssues.map((issue) => issue.title).join("；")}`);
  }

  postProgress(requestId, 0.3, "cluster", "正在执行聚类计算");
  await yieldToEventLoop();
  let result;
  const input = {
    rows,
    definitions,
    clusterVariables,
    options: methodOptions || {}
  };
  if (method === "kmeans") {
    input.weightColumn = weightColumn || "";
    result = core.kmeansCluster(input);
  } else if (method === "twostep") {
    result = core.twostepCluster(input);
  } else if (method === "hierarchical") {
    result = core.hierarchicalCluster(input);
  } else {
    throw new Error(`未知的聚类方法：${method}`);
  }
  result.qualityChecks = qualityChecks;

  postProgress(requestId, 0.7, "profile", "正在生成群体画像");
  await yieldToEventLoop();
  let profile = null;
  if (!(method === "hierarchical" && (methodOptions || {}).object === "variables")) {
    profile = core.profileClusters({
      rows,
      definitions,
      clusterVariables,
      profileVariables: profileVariables || [],
      assignments: result.assignments,
      clusterSizes: result.clusterSizes
    });
  }
  result.profile = profile;
  result.variableDefinitions = definitions;

  postProgress(requestId, 0.9, "export", "正在整理输出");
  if (cancelled) throw new Error("任务已取消。");
  return result;
}

self.onmessage = async (event) => {
  const { type, requestId, payload } = event.data || {};
  if (type === "cluster_cancel") {
    if (currentRequestId && currentRequestId === requestId) {
      cancelled = true;
      self.postMessage({ type: "cluster_error", requestId, errorCode: "cancelled", message: "任务已取消。" });
      currentRequestId = null;
    }
    return;
  }
  if (type !== "cluster_run") return;
  if (currentRequestId) {
    self.postMessage({ type: "cluster_error", requestId, errorCode: "busy", message: "已有聚类任务正在执行，请先取消或等待完成。" });
    return;
  }
  currentRequestId = requestId;
  cancelled = false;
  try {
    const result = await runCluster(payload, requestId);
    if (cancelled) return;
    self.postMessage({ type: "cluster_done", requestId, result });
  } catch (error) {
    if (!cancelled) {
      self.postMessage({
        type: "cluster_error",
        requestId,
        errorCode: error.code || "cluster_failed",
        message: error.message || "聚类计算失败",
        details: error.stack || ""
      });
    }
  } finally {
    currentRequestId = null;
  }
};

self.postMessage({ type: "cluster_ready", requestId: "" });
