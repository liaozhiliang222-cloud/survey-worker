import { checkQuestionnaire, QUESTIONNAIRE_SCENARIO_LABELS } from "../../../lib/tools/questionnaire-check.mjs";

const API_ROOT = "/api/tools";
const CONTEXT_KEY = "surveykit.tool-project-context.v1";
const VIEW_BY_TOOL = { "sample-size": "sample", quota: "quota", "questionnaire-check": "link-test" };
const executionState = new Map();
let openingFromProject = false;

function projectContext() {
  try {
    const value = JSON.parse(sessionStorage.getItem(CONTEXT_KEY) || "null");
    return value?.project_id ? value : null;
  } catch { return null; }
}

function setProjectContext(value) {
  if (!value?.project_id) sessionStorage.removeItem(CONTEXT_KEY);
  else sessionStorage.setItem(CONTEXT_KEY, JSON.stringify({ project_id: String(value.project_id), project_name: String(value.project_name || "当前项目") }));
  renderProjectContext();
}

async function request(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (typeof options.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_ROOT}${path}`, { credentials: "same-origin", ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload?.error?.message || "专业工具请求未完成。");
    error.code = payload?.error?.code || "TOOL_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function listTools() { return request(""); }
export async function invokeTool(toolId, input) { return request(`/${encodeURIComponent(toolId)}`, { method: "POST", body: JSON.stringify({ input }) }); }
export async function saveToolResult(toolId, projectId, input) { return request(`/${encodeURIComponent(toolId)}/results`, { method: "POST", body: JSON.stringify({ project_id: projectId, input }) }); }
export async function listToolResults(projectId) { return request(`/results?project_id=${encodeURIComponent(projectId)}`); }
export function checkQuestionnaireLocally(input) { return checkQuestionnaire(input); }
export { QUESTIONNAIRE_SCENARIO_LABELS };

export function rememberExecution(toolId, input, data) {
  executionState.set(toolId, { input, data });
  document.querySelectorAll(`[data-save-tool-result="${toolId}"]`).forEach((button) => { button.disabled = false; });
}

export function openToolFromProject(toolId, project) {
  const view = VIEW_BY_TOOL[toolId];
  if (!view || !project?.id) return;
  setProjectContext({ project_id: project.id, project_name: project.title || "当前项目" });
  const navigation = document.querySelector(`[data-view="${view}"]`);
  openingFromProject = true;
  if (navigation) navigation.click();
  else window.location.hash = view;
  window.dispatchEvent(new CustomEvent("surveykit:tool-project-opened", { detail: { tool_id: toolId, project_id: project.id } }));
  queueMicrotask(() => { openingFromProject = false; });
}

function renderProjectContext() {
  const context = projectContext();
  document.querySelectorAll("[data-tool-project-context]").forEach((element) => {
    element.hidden = !context;
    element.textContent = context ? `当前项目：${context.project_name} · 结果可保存到项目` : "";
  });
  document.querySelectorAll("[data-save-tool-result]").forEach((button) => {
    button.hidden = !context;
    button.disabled = !executionState.has(button.dataset.saveToolResult);
  });
}

async function saveCurrentExecution(button) {
  const toolId = button.dataset.saveToolResult;
  const context = projectContext();
  const execution = executionState.get(toolId);
  if (!context || !execution) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    await saveToolResult(toolId, context.project_id, execution.input);
    button.textContent = "已保存到项目";
    window.dispatchEvent(new CustomEvent("surveykit:tool-result-saved", { detail: { project_id: context.project_id, tool_id: toolId } }));
    setTimeout(() => { button.textContent = original; button.disabled = false; }, 1600);
  } catch (error) {
    button.textContent = error.message;
    setTimeout(() => { button.textContent = original; button.disabled = false; }, 2200);
  }
}

export function initToolGatewayUi() {
  renderProjectContext();
  document.querySelectorAll("[data-save-tool-result]").forEach((button) => button.addEventListener("click", () => saveCurrentExecution(button)));
  Object.values(VIEW_BY_TOOL).forEach((view) => document.querySelector(`[data-view="${view}"]`)?.addEventListener("click", () => {
    if (!openingFromProject) setProjectContext(null);
  }));
}

export const toolGatewayApi = { listTools, invokeTool, saveToolResult, listToolResults, rememberExecution, openToolFromProject, checkQuestionnaireLocally, projectContext, setProjectContext };
