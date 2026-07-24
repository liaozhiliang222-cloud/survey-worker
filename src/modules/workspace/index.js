/**
 * 工作台模块 — 项目管理、Dashboard 渲染、流程节点
 * 从 app.js 提取，依赖 shared/store.js 集中状态
 */

import { state, resetWorkspaceRuntimeState } from "../../shared/store.js";
import { showToast } from "../../shared/toast.js";
import { escapeHtml } from "../../shared/export.js";
import { formatPercent } from "../../shared/stats.js";

const WORKSPACE_LIBRARY_KEY = "surveyWorkspaceLibrary.v2";
const WORKSPACE_LEGACY_KEY = "surveyWorkspaceProject";

// ─── 工具函数 ───────────────────────────────────────────────

export function createWorkspaceId() {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeWorkspaceProject(raw = {}) {
  return {
    id: raw.id || createWorkspaceId(),
    projectName: raw.projectName || "",
    studyType: raw.studyType || "概念测试",
    stage: raw.stage || "调研前",
    sampleTarget: Number(raw.sampleTarget) || 0,
    quotaDimensions: raw.quotaDimensions || "",
    questionnaireText: raw.questionnaireText || "",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || null,
    archivedAt: raw.archivedAt || null,
    status: raw.status || {},
    assets: raw.assets || {},
    reportPlans: Array.isArray(raw.reportPlans) ? raw.reportPlans : [],
    proposalDecks: Array.isArray(raw.proposalDecks) ? raw.proposalDecks : [],
    activities: Array.isArray(raw.activities) ? raw.activities : []
  };
}

export function formatShortDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ─── 持久化 ─────────────────────────────────────────────────

export function loadWorkspaceLibrary() {
  if (state.workspaceLibrary) return state.workspaceLibrary;
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_LIBRARY_KEY) || "null");
    if (parsed?.projects?.length) {
      state.workspaceLibrary = {
        version: 2,
        activeProjectId: parsed.activeProjectId,
        projects: parsed.projects.map(normalizeWorkspaceProject)
      };
      if (!state.workspaceLibrary.projects.some((p) => p.id === state.workspaceLibrary.activeProjectId)) {
        state.workspaceLibrary.activeProjectId = state.workspaceLibrary.projects[0].id;
      }
      return state.workspaceLibrary;
    }
  } catch { /* ignore */ }
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(WORKSPACE_LEGACY_KEY) || "null"); } catch { /* ignore */ }
  const projects = legacy ? [normalizeWorkspaceProject(legacy)] : [];
  state.workspaceLibrary = { version: 2, activeProjectId: projects[0]?.id || null, projects };
  persistWorkspaceLibrary();
  return state.workspaceLibrary;
}

export function persistWorkspaceLibrary() {
  if (!state.workspaceLibrary) return;
  try {
    localStorage.setItem(WORKSPACE_LIBRARY_KEY, JSON.stringify(state.workspaceLibrary));
    const active = state.workspaceLibrary.projects.find((p) => p.id === state.workspaceLibrary.activeProjectId);
    if (active) localStorage.setItem(WORKSPACE_LEGACY_KEY, JSON.stringify(active));
    else localStorage.removeItem(WORKSPACE_LEGACY_KEY);
  } catch { /* 隐私模式 */ }
}

// ─── 项目 CRUD ──────────────────────────────────────────────

function recordWorkspaceActivity(project, text, type = "update") {
  if (!project || !text) return;
  project.activities = [
    { id: createWorkspaceId(), type, text: String(text), at: new Date().toISOString() },
    ...(project.activities || [])
  ].slice(0, 30);
}

export function upsertWorkspaceProject(project, activityText = "") {
  const library = loadWorkspaceLibrary();
  const normalized = normalizeWorkspaceProject(project);
  normalized.updatedAt = new Date().toISOString();
  if (activityText) recordWorkspaceActivity(normalized, activityText);
  const index = library.projects.findIndex((item) => item.id === normalized.id);
  if (index >= 0) library.projects[index] = normalized;
  else library.projects.unshift(normalized);
  library.activeProjectId = normalized.id;
  state.workspaceProject = normalized;
  persistWorkspaceLibrary();
  renderWorkspaceProjectLibrary();
  return normalized;
}

export function loadWorkspaceProject() {
  const library = loadWorkspaceLibrary();
  return library.projects.find((p) => p.id === library.activeProjectId) || null;
}

// ─── 流程节点定义 ───────────────────────────────────────────

export function workspaceFlowNodes() {
  return [
    { id: "project_setup", stage: "调研前", name: "项目档案", detail: "项目名、类型、目标样本", action: "编辑", jump: "overview" },
    { id: "proposal_design", stage: "调研前", name: "方案设计", detail: "AI 生成调研方案", action: "生成方案", jump: "ai-plan", dependsOn: "project_setup" },
    { id: "questionnaire_design", stage: "调研前", name: "问卷设计", detail: "AI 问卷或导入问卷", action: "设计问卷", jump: "ai-assistant", dependsOn: "proposal_design" },
    { id: "quality_check", stage: "调研前", name: "上线质检", detail: "检查跳题、排他项、风险", action: "查看质检", jump: "link-test", dependsOn: "questionnaire_design" },
    { id: "data_import", stage: "数据清洗", name: "数据导入", detail: "CSV / Excel / SAV", action: "导入数据", jump: "cleaning-rules", dependsOn: "quality_check" },
    { id: "rule_generation", stage: "数据清洗", name: "规则生成", detail: "本地规则 + AI 辅助", action: "生成规则", jump: "cleaning-rules", dependsOn: "data_import" },
    { id: "threshold_adjustment", stage: "数据清洗", name: "阈值调整", detail: "可新增、删除、编辑规则", action: "进入调整", jump: "cleaning-rules", dependsOn: "rule_generation" },
    { id: "cleaning_execution", stage: "数据清洗", name: "清洗执行", detail: "输出清洗后数据和报告", action: "执行清洗", jump: "cleaning-rules", dependsOn: "threshold_adjustment" },
    { id: "data_weighting", stage: "数据清洗", name: "数据加权", detail: "RIM / Cell 加权", action: "计算权重", jump: "data-weighting", dependsOn: "cleaning_execution" },
    { id: "crosstab", stage: "分析产出", name: "交叉表分析", detail: "默认复用清洗后数据", action: "进入分析", jump: "crosstab-analysis", dependsOn: "cleaning_execution" },
    { id: "model_psm", stage: "分析产出", name: "PSM 模型", detail: "价格敏感度分析", action: "PSM", jump: "psm", dependsOn: "cleaning_execution" },
    { id: "model_kano", stage: "分析产出", name: "KANO 模型", detail: "需求属性分类", action: "KANO", jump: "kano", dependsOn: "cleaning_execution" },
    { id: "model_maxdiff", stage: "分析产出", name: "MaxDiff 模型", detail: "相对偏好排序", action: "MaxDiff", jump: "maxdiff", dependsOn: "cleaning_execution" },
    { id: "ai_report", stage: "分析产出", name: "AI 洞察报告", detail: "Markdown 报告", action: "生成报告", jump: "ai-report", dependsOn: "crosstab" },
    { id: "report_delivery", stage: "分析产出", name: "报告交付", detail: "MD / Word / PPT", action: "导出报告", jump: "ai-report", dependsOn: "ai_report" },
    { id: "project_archive", stage: "交付归档", name: "项目归档", detail: "冻结项目产出", action: "归档项目", jump: "overview", dependsOn: "report_delivery" },
    { id: "export_assets", stage: "交付归档", name: "导出资产包", detail: "打包项目资料", action: "导出全部", jump: "overview", dependsOn: "project_archive" }
  ];
}

export function workspaceQualityScore(status) {
  const score = 40
    + (status.project_setup ? 8 : 0)
    + (status.questionnaire_design ? 8 : 0)
    + (status.quality_check ? 10 : 0)
    + (status.cleaning_execution ? 18 : 0)
    + (status.data_weighting ? 6 : 0)
    + (status.crosstab ? 6 : 0)
    + (status.ai_report ? 4 : 0);
  const finalScore = Math.min(100, score);
  const grade = finalScore >= 90 ? "A" : finalScore >= 75 ? "B" : finalScore >= 60 ? "C" : "D";
  return { score: finalScore, grade };
}

// ─── DOM 渲染 ───────────────────────────────────────────────

export function renderWorkspaceProjectLibrary() {
  const library = loadWorkspaceLibrary();
  const select = document.querySelector("#workspaceProjectSelect");
  const showArchived = Boolean(document.querySelector("#workspaceShowArchived")?.checked);
  const visible = library.projects.filter((p) => showArchived || !p.archivedAt || p.id === library.activeProjectId);
  if (select) {
    select.innerHTML = visible.length
      ? visible.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === library.activeProjectId ? "selected" : ""}>${escapeHtml(p.projectName || "未命名项目")}${p.archivedAt ? "（已归档）" : ""}</option>`).join("")
      : '<option value="">尚未创建项目</option>';
    select.disabled = visible.length === 0;
  }
  const count = document.querySelector("#workspaceProjectCount");
  if (count) count.textContent = `${library.projects.filter((p) => !p.archivedAt).length} 个进行中 · ${library.projects.filter((p) => p.archivedAt).length} 个已归档`;
}

export function fillWorkspaceProject(project) {
  if (!project) return;
  const nameEl = document.querySelector("#workspaceProjectName");
  const typeEl = document.querySelector("#workspaceStudyType");
  const stageEl = document.querySelector("#workspaceStage");
  const sampleEl = document.querySelector("#workspaceSampleTarget");
  const quotaEl = document.querySelector("#workspaceQuotaDimensions");
  const questEl = document.querySelector("#workspaceQuestionnaire");
  if (nameEl) nameEl.value = project.projectName || "";
  if (typeEl) typeEl.value = project.studyType || "概念测试";
  if (stageEl) stageEl.value = project.stage || "调研前";
  if (sampleEl) sampleEl.value = project.sampleTarget || "";
  if (quotaEl) quotaEl.value = project.quotaDimensions || "";
  if (questEl) questEl.value = project.questionnaireText || "";
}

export function activateWorkspaceProject(projectId) {
  const library = loadWorkspaceLibrary();
  const project = library.projects.find((item) => item.id === projectId);
  if (!project) return;
  library.activeProjectId = project.id;
  state.workspaceProject = project;
  resetWorkspaceRuntimeState();
  persistWorkspaceLibrary();
  fillWorkspaceProject(project);
  renderWorkspaceProjectLibrary();
  showToast("已切换项目；问卷和配置已恢复，文件类资产需要按需重新上传", "info", 3600);
}

export function createNewWorkspaceProject() {
  const project = normalizeWorkspaceProject({ projectName: "", studyType: "概念测试", stage: "调研前" });
  state.workspaceProject = upsertWorkspaceProject(project, "创建新项目");
  resetWorkspaceRuntimeState();
  fillWorkspaceProject(project);
}

export function archiveWorkspaceProject() {
  const project = loadWorkspaceProject();
  if (!project) return;
  project.archivedAt = project.archivedAt ? null : new Date().toISOString();
  project.status = { ...(project.status || {}), archive: Boolean(project.archivedAt) };
  state.workspaceProject = upsertWorkspaceProject(project, project.archivedAt ? "归档项目" : "恢复项目");
  fillWorkspaceProject(state.workspaceProject);
}

export function deleteWorkspaceProject() {
  const library = loadWorkspaceLibrary();
  const project = library.projects.find((item) => item.id === library.activeProjectId);
  if (!project) return;
  if (!window.confirm(`确定删除项目"${project.projectName || "未命名项目"}"吗？`)) return;
  library.projects = library.projects.filter((item) => item.id !== project.id);
  library.activeProjectId = library.projects.find((item) => !item.archivedAt)?.id || library.projects[0]?.id || null;
  state.workspaceLibrary = library;
  state.workspaceProject = library.projects.find((item) => item.id === library.activeProjectId) || null;
  persistWorkspaceLibrary();
  resetWorkspaceRuntimeState();
  if (state.workspaceProject) fillWorkspaceProject(state.workspaceProject);
  renderWorkspaceProjectLibrary();
  showToast("项目已删除", "success");
}
