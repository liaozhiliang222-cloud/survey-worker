/**
 * 全局应用状态 Store
 * 将 app.js 中散落的 180+ 全局 let 变量集中管理
 * 各功能模块通过 import { state } 访问，避免全局污染
 */

export const state = {
  // ─── 工作台 ───────────────────────────────────────────────
  workspaceLibrary: null,
  workspaceProject: null,

  // ─── 交叉表 ───────────────────────────────────────────────
  lastCrosstabDataContext: null,
  lastHeaderPlan: null,
  crosstabQuestionnaireMap: {},

  // ─── 数据清洗 ─────────────────────────────────────────────
  cleaningCenterState: { parsed: null, rules: [], result: null, fileName: "" },
  lastCleaningRules: null,

  // ─── 加权 ─────────────────────────────────────────────────
  lastWeightingResult: null,

  // ─── AI 功能 ──────────────────────────────────────────────
  lastAiPlan: null,
  lastAiReport: null,
  lastAiActualModel: "",

  // ─── 模型分析 ─────────────────────────────────────────────
  lastPsmAnalysis: null,
  lastKanoAnalysis: null,
  lastMaxDiffDesign: null,
  lastMaxDiffScore: null,
  lastAbcSuggestions: null,

  // ─── 质检 ─────────────────────────────────────────────────
  lastAuditReport: null,

  // ─── PPT 报告 ─────────────────────────────────────────────
  pptxReportState: {
    jobId: null,
    polling: false,
    lastResult: null
  },

  // ─── 提案 Deck ────────────────────────────────────────────
  proposalDecks: [],

  // ─── UI 状态 ──────────────────────────────────────────────
  currentView: "dashboard",
  views: [],
  navItems: []
};

/**
 * 重置工作台运行时状态（切换项目时调用）
 */
export function resetWorkspaceRuntimeState() {
  state.lastCrosstabDataContext = null;
  state.lastWeightingResult = null;
  state.lastCleaningRules = null;
  state.cleaningCenterState = { parsed: null, rules: [], result: null, fileName: "" };
  state.lastHeaderPlan = null;
  state.lastAiPlan = null;
  state.lastAuditReport = null;
  state.lastAiReport = null;
  state.lastPsmAnalysis = null;
  state.lastKanoAnalysis = null;
  state.lastMaxDiffDesign = null;
  state.lastMaxDiffScore = null;
}
