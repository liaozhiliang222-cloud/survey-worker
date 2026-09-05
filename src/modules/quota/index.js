/**
 * 配额设计模块 — 单维度配额 + 交叉配额 + 整数分配算法
 */

import { escapeHtml } from "../../shared/export.js";
import { allocateIntegers, normalizeQuota } from "../../../lib/tools/quota.mjs";

export { allocateIntegers, calculateQuota, normalizeQuota, parseQuotaItems } from "../../../lib/tools/quota.mjs";

// ─── 纯计算函数 ─────────────────────────────────────────────

/**
 * 最大余数法整数分配
 * @param {number[]} values - 各组的精确配额值
 * @param {number} total - 总配额
 * @returns {number[]} 整数分配结果
 */
/**
 * 计算单维度配额分配
 * @param {Array<{name: string, share: number}>} items - 配额选项
 * @param {number} totalSample - 总样本量
 * @returns {Array<{name: string, share: number, weight: number, count: number}>}
 */
export function computeSingleQuota(items, totalSample) {
  const normalized = normalizeQuota(items);
  if (!normalized.length) return [];
  const counts = allocateIntegers(normalized.map((item) => item.weight * totalSample), totalSample);
  return normalized.map((item, index) => ({ ...item, count: counts[index] }));
}

/**
 * 计算交叉配额矩阵
 * @param {Array<{name: string, items: Array<{name: string, share: number}>}>} dimensions
 * @param {number} totalSample
 * @returns {{ matrix: object[], flat: object[] }}
 */
export function computeCrossQuota(dimensions, totalSample) {
  if (!dimensions.length) return { matrix: [], flat: [] };
  const normalizedDims = dimensions.map((dim) => ({
    name: dim.name,
    items: normalizeQuota(dim.items)
  }));

  // 生成笛卡尔积
  let cells = [{ labels: {}, weight: 1 }];
  for (const dim of normalizedDims) {
    const next = [];
    for (const cell of cells) {
      for (const item of dim.items) {
        next.push({
          labels: { ...cell.labels, [dim.name]: item.name },
          weight: cell.weight * item.weight
        });
      }
    }
    cells = next;
  }

  const totalWeight = cells.reduce((sum, cell) => sum + cell.weight, 0);
  const exactValues = cells.map((cell) => (cell.weight / totalWeight) * totalSample);
  const counts = allocateIntegers(exactValues, totalSample);

  const flat = cells.map((cell, index) => ({
    ...cell.labels,
    percent: totalWeight > 0 ? cell.weight / totalWeight : 0,
    count: counts[index]
  }));

  return { matrix: normalizedDims, flat };
}

// ─── DOM 交互（初始化后调用）────────────────────────────────

export function initQuotaModule() {
  const singleContainer = document.querySelector("#singleQuotaDimensions");
  const crossContainer = document.querySelector("#crossQuotaDimensions");
  if (!singleContainer && !crossContainer) return;

  // 单维度配额默认初始化
  if (singleContainer && !singleContainer.children.length) {
    addQuotaDimension("性别", [["男", 50], ["女", 50]]);
  }
}

function addQuotaDimension(name = "性别", options = []) {
  const container = document.querySelector("#singleQuotaDimensions");
  if (!container) return;
  const dimension = document.createElement("div");
  dimension.className = "quota-dimension";
  dimension.innerHTML = `
    <span class="quota-dimension-title">配额维度</span>
    <div class="quota-dimension-head">
      <input class="quota-dimension-name" type="text" placeholder="维度名称" value="${escapeHtml(name)}" />
      <button class="icon-btn" type="button" aria-label="删除配额维度">×</button>
    </div>
    <div class="quota-option-list"></div>
    <div class="quota-total-status">合计 0%</div>
    <button class="secondary-btn add-quota-option" type="button">添加配额选项</button>
  `;
  container.appendChild(dimension);

  dimension.querySelector(".add-quota-option")?.addEventListener("click", () => {
    addQuotaOption(dimension);
  });
  dimension.querySelector(".quota-dimension-head button")?.addEventListener("click", () => {
    if (container.children.length <= 1) return;
    dimension.remove();
  });

  const initialOptions = options.length ? options : [["选项", 100]];
  initialOptions.forEach(([optionName, share]) => addQuotaOption(dimension, optionName, share));
}

function addQuotaOption(dimension, name = "", share = "") {
  const list = dimension.querySelector(".quota-option-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "quota-item-row";
  row.innerHTML = `
    <input class="single-quota-name" type="text" placeholder="配额选项" value="${escapeHtml(name)}" />
    <input class="single-quota-share" type="number" min="0" placeholder="比例" value="${escapeHtml(share)}" />
    <button class="icon-btn" type="button" aria-label="删除配额选项">×</button>
  `;
  list.appendChild(row);
  row.querySelector("button")?.addEventListener("click", () => {
    if (list.children.length <= 1) return;
    row.remove();
  });
}
