/**
 * localStorage 封装 — 项目工作台数据持久化
 */

const WORKSPACE_LIBRARY_KEY = "surveyWorkspaceLibrary.v2";
const WORKSPACE_LEGACY_KEY = "surveyWorkspaceProject";

export function loadWorkspaceLibrary() {
  try {
    const raw = localStorage.getItem(WORKSPACE_LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects)) return parsed;
    }
  } catch { /* ignore */ }
  // 迁移旧版单项目
  try {
    const legacy = localStorage.getItem(WORKSPACE_LEGACY_KEY);
    if (legacy) {
      const project = JSON.parse(legacy);
      if (project && typeof project === "object") {
        const library = { projects: [project], activeId: project.id || "" };
        persistWorkspaceLibrary(library);
        localStorage.removeItem(WORKSPACE_LEGACY_KEY);
        return library;
      }
    }
  } catch { /* ignore */ }
  return { projects: [], activeId: "" };
}

export function persistWorkspaceLibrary(library) {
  try {
    localStorage.setItem(WORKSPACE_LIBRARY_KEY, JSON.stringify(library));
  } catch { /* 隐私模式忽略写入 */ }
}

export function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

export function loadNetGroupConfig() {
  return loadJson("surveyNetGroupConfig", {});
}

export function saveNetGroupConfig(config) {
  saveJson("surveyNetGroupConfig", config);
}

export function loadAiSettings() {
  return loadJson("surveyAiSettings", null);
}

export function saveAiSettings(settings) {
  saveJson("surveyAiSettings", settings);
}
