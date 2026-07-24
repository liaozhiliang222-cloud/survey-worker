/**
 * 样本量计算模块
 */

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
export function calculateSampleSize({ z = 1.96, marginPercent = 5, population = 0, segments = 1, responseRatePercent = 80 }) {
  const margin = marginPercent / 100;
  const responseRate = Math.max(1, responseRatePercent) / 100;
  const segs = Math.max(1, segments);
  const p = 0.5;

  const infiniteSample = (z * z * p * (1 - p)) / (margin * margin);
  const adjustedSample = population > 0
    ? infiniteSample / (1 + (infiniteSample - 1) / population)
    : infiniteSample;

  const base = Math.ceil(adjustedSample);
  const segment = Math.ceil(base / segs);
  const gross = Math.ceil(base / responseRate);

  const populationText = population > 0 ? `用户规模 ${population.toLocaleString("zh-CN")}、` : "用户规模不设上限、";
  const advice = `${populationText}允许误差 ${Math.round(margin * 100)}% 时，建议至少回收 ${base.toLocaleString("zh-CN")} 个有效样本；按当前回收率预估需发放 ${gross.toLocaleString("zh-CN")} 份。`;

  return { base, gross, segment, advice };
}

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
