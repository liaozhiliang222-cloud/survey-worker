/** 样本量计算模块。核心算法由 Tool Service 统一提供。 */

import { calculateSampleSize } from "../../../lib/tools/sample-size.mjs";

export { calculateSampleSize };

/**
 * 计算所需样本量
 * @param {object} params
 * @param {number} params.z - 置信度对应 Z 值（如 1.96 = 95%）
 * @param {number} params.marginPercent - 允许误差百分比（如 5 表示 ±5%）
 * @param {number} params.population - 总体规模（0 表示无限总体）
 * @param {number} params.segments - 分组数
 * @param {number} params.responseRatePercent - 预估回收率百分比
 * @returns {{ base: number, gross: number, segment: number, advice: string }}
 */
/**
 * 绑定样本量表单事件（DOM 初始化后调用）
 */
export function initSampleForm() {
  const form = document.querySelector("#sampleForm");
  if (!form) return;

  const render = () => {
    const z = Number(document.querySelector("#confidence")?.value) || 1.96;
    const marginPercent = Number(document.querySelector("#margin")?.value) || 5;
    const population = Number(document.querySelector("#population")?.value) || 0;
    const segments = Number(document.querySelector("#segments")?.value) || 1;
    const responseRate = Number(document.querySelector("#responseRate")?.value) || 80;

    const result = calculateSampleSize({ z, marginPercent, population, segments, responseRatePercent: responseRate });

    const baseEl = document.querySelector("#baseSample");
    const grossEl = document.querySelector("#grossSample");
    const segmentEl = document.querySelector("#segmentSample");
    const adviceEl = document.querySelector("#sampleAdvice");
    if (baseEl) baseEl.textContent = result.base.toLocaleString("zh-CN");
    if (grossEl) grossEl.textContent = result.gross.toLocaleString("zh-CN");
    if (segmentEl) segmentEl.textContent = result.segment.toLocaleString("zh-CN");
    if (adviceEl) adviceEl.textContent = result.advice;
  };

  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", render);
  });
  render();
}
