/**
 * IndexedDB 封装 — 用于持久化大块项目数据（原始数据、清洗结果、加权结果、模型结果等）。
 *
 * 设计目标：
 * - localStorage 只存项目库元数据 + 用户设置（< 5MB）
 * - IndexedDB 存按 projectId 隔离的大块数据集（无上限压力）
 * - 调用方仍用同步内存读取（projectDataBus），本模块负责后台异步持久化与按需回填
 *
 * 数据结构：
 * - DB: surveykit-db
 * - Store: projectData
 * - Key: `${projectId}::${dataKey}`（如 "abc123::cleanedData"）
 * - Value: { projectId, dataKey, value, meta, updatedAt }
 */

const DB_NAME = "surveykit-db";
const DB_VERSION = 1;
const STORE_NAME = "projectData";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB 不可用"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("by_project", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function keyFor(projectId, dataKey) {
  return `${projectId}::${dataKey}`;
}

/**
 * 写入一条项目数据（异步，不阻塞调用方）
 * @param {string} projectId
 * @param {string} dataKey - 如 "rawData" / "cleanedData" / "modelResults.psm"
 * @param {*} value
 * @param {object} meta
 */
export async function saveProjectData(projectId, dataKey, value, meta = {}) {
  if (!projectId || !dataKey) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      key: keyFor(projectId, dataKey),
      projectId,
      dataKey,
      value,
      meta,
      updatedAt: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    // IndexedDB 写入失败不应阻塞主流程，仅控制台告警
    console.warn(`[idb] 保存 ${dataKey} 失败：`, error?.message || error);
  }
}

/**
 * 读取单条项目数据
 * @param {string} projectId
 * @param {string} dataKey
 * @returns {Promise<{value:*, meta:object, updatedAt:number}|null>}
 */
export async function loadProjectData(projectId, dataKey) {
  if (!projectId || !dataKey) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(keyFor(projectId, dataKey));
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[idb] 读取 ${dataKey} 失败：`, error?.message || error);
    return null;
  }
}

/**
 * 加载某个项目的全部数据条目（用于切回项目时回填 projectDataBus）
 * @param {string} projectId
 * @returns {Promise<Array<{dataKey:string, value:*, meta:object, updatedAt:number}>>}
 */
export async function loadAllProjectData(projectId) {
  if (!projectId) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("by_project");
    const request = index.getAll(IDBKeyRange.only(projectId));
    const records = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return records.map((record) => ({
      dataKey: record.dataKey,
      value: record.value,
      meta: record.meta || {},
      updatedAt: record.updatedAt,
    }));
  } catch (error) {
    console.warn(`[idb] 读取项目 ${projectId} 全部数据失败：`, error?.message || error);
    return [];
  }
}

/**
 * 删除某个项目的全部数据条目（项目删除时调用）
 * @param {string} projectId
 */
export async function clearProjectData(projectId) {
  if (!projectId) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("by_project");
    const cursorRequest = index.openCursor(IDBKeyRange.only(projectId));
    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn(`[idb] 清理项目 ${projectId} 数据失败：`, error?.message || error);
  }
}

/**
 * 检查存储用量并返回占比信息，用于容量预警
 * @returns {Promise<{usage:number, quota:number, ratio:number}|null>}
 */
export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usage,
      quota,
      ratio: quota > 0 ? usage / quota : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 容量预警：超过阈值时返回告警信息
 * @param {number} warnRatio - 默认 0.8
 * @returns {Promise<{level:"ok"|"warn"|"critical", message:string}|null>}
 */
export async function checkStorageHealth(warnRatio = 0.8) {
  const estimate = await estimateStorage();
  if (!estimate) return null;
  if (estimate.ratio >= 0.95) {
    return {
      level: "critical",
      message: `浏览器存储空间已使用 ${Math.round(estimate.ratio * 100)}%（${Math.round(estimate.usage / 1024 / 1024)}MB / ${Math.round(estimate.quota / 1024 / 1024)}MB），建议导出备份并清理已归档项目。`,
    };
  }
  if (estimate.ratio >= warnRatio) {
    return {
      level: "warn",
      message: `浏览器存储空间使用 ${Math.round(estimate.ratio * 100)}%（${Math.round(estimate.usage / 1024 / 1024)}MB / ${Math.round(estimate.quota / 1024 / 1024)}MB），建议导出备份。`,
    };
  }
  return { level: "ok", message: "" };
}
