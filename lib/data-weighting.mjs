// @ts-check
import { finiteDataNumber as finite } from "./data-values.mjs";

/** @typedef {Record<string, unknown>} DataRow */
/** @typedef {{value:string, share:number}} WeightCategory */
/** @typedef {{variable:string, categories:WeightCategory[]}} WeightTarget */
/** @typedef {{max_iterations?:number, tolerance?:number, trim?:{min?:number,max?:number}}} WeightOptions */

export class WeightingInputError extends Error {
  /** @param {string} message @param {string} code @param {Record<string, unknown>} [details] */
  constructor(message, code, details = {}) { super(message); this.name = "WeightingInputError"; this.code = code; this.details = details; }
}

/** @param {unknown} value */
const text = (value) => String(value ?? "").trim();
/** @param {number} value @param {number} [digits] */
const rounded = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
/** @param {string[]} values */
const unique = (values) => [...new Set(values)];

/**
 * @param {unknown} input
 * @param {string[]} headers
 * @param {DataRow[]} rows
 * @returns {WeightTarget[]}
 */
export function normalizeWeightTargets(input, headers, rows) {
  if (!Array.isArray(input) || !input.length) throw new WeightingInputError("加权需要明确的目标总体分布。", "WEIGHT_TARGETS_REQUIRED");
  return input.slice(0, 5).map((rawTarget, targetIndex) => {
    const target = /** @type {Record<string, unknown>} */ (rawTarget || {}); const variable = text(target.variable);
    if (!headers.includes(variable)) throw new WeightingInputError(`加权字段 ${variable || "(空)"} 不存在。`, "FIELD_NOT_FOUND", { field: variable });
    if (!Array.isArray(target.categories) || target.categories.length < 2 || target.categories.length > 30) throw new WeightingInputError(`加权字段 ${variable} 需要 2～30 个目标类别。`, "WEIGHT_TARGET_INVALID", { target_index: targetIndex });
    const categories = target.categories.map((rawCategory) => { const category = /** @type {Record<string, unknown>} */ (rawCategory || {}); return { value: text(category.value), share: finite(category.share) }; });
    if (categories.some((category) => !category.value || category.share == null || category.share <= 0)) throw new WeightingInputError(`加权字段 ${variable} 的类别或比例无效。`, "WEIGHT_TARGET_INVALID", { field: variable });
    if (new Set(categories.map((category) => category.value)).size !== categories.length) throw new WeightingInputError(`加权字段 ${variable} 存在重复目标类别。`, "WEIGHT_TARGET_INVALID", { field: variable });
    const observed = unique(rows.map((row) => text(row[variable])));
    if (observed.includes("")) throw new WeightingInputError(`加权字段 ${variable} 存在缺失值，请先清洗或明确补值规则。`, "WEIGHT_FIELD_MISSING", { field: variable });
    const supplied = new Set(categories.map((category) => category.value)); const missing = observed.filter((value) => !supplied.has(value)); const absent = categories.map((category) => category.value).filter((value) => !observed.includes(value));
    if (missing.length || absent.length) throw new WeightingInputError(`加权字段 ${variable} 的目标类别必须完整匹配数据中的实际类别。`, "WEIGHT_TARGET_MISMATCH", { field: variable, missing_categories: missing.slice(0, 20), absent_categories: absent.slice(0, 20) });
    const total = categories.reduce((sum, category) => sum + /** @type {number} */ (category.share), 0);
    return { variable, categories: categories.map((category) => ({ value: category.value, share: /** @type {number} */ (category.share) / total })) };
  });
}

/** @param {(DataRow & {__weight:number})[]} rows @param {WeightTarget[]} targets @param {number} iterations @param {boolean} converged @param {number} maxDelta @param {number} trimmed */
function diagnostics(rows, targets, iterations, converged, maxDelta, trimmed) {
  const weights = rows.map((row) => row.__weight).filter((value) => value > 0); const sum = weights.reduce((total, value) => total + value, 0); const squared = weights.reduce((total, value) => total + value ** 2, 0);
  const margins = targets.flatMap((target) => target.categories.map((category) => { const matching = rows.filter((row) => text(row[target.variable]) === category.value); const weighted = matching.reduce((total, row) => total + row.__weight, 0); return { variable: target.variable, category: category.value, raw_count: matching.length, raw_share: rounded(matching.length / rows.length, 6), target_share: rounded(category.share, 6), weighted_share: rounded(sum ? weighted / sum : 0, 6) }; }));
  const effectiveN = squared ? (sum ** 2) / squared : 0;
  return { method: "rim", iterations, converged, max_margin_delta: rounded(maxDelta, 8), effective_n: rounded(effectiveN, 1), design_effect: rounded(effectiveN && rows.length ? rows.length / effectiveN : 0, 4), min_weight: rounded(weights.reduce((min, weight) => Math.min(min, weight), Infinity), 4), max_weight: rounded(weights.reduce((max, weight) => Math.max(max, weight), 0), 4), trimmed, margins };
}

/** Normalize to mean 1 while respecting FINAL weight bounds.
 * @param {(DataRow & {__weight:number})[]} rows
 * @param {number | null} minimum
 * @param {number | null} maximum
 */
function boundedNormalize(rows, minimum, maximum) {
  const weights = rows.map((row) => row.__weight);
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) throw new WeightingInputError("权重数值不稳定，请检查目标分布。", "WEIGHT_NUMERIC_INVALID");
  const minWeight = weights.reduce((min, weight) => Math.min(min, weight), Infinity);
  const clamp = /** @param {number} value */ (value) => Math.min(maximum ?? Infinity, Math.max(minimum ?? 0, value));
  let lower = 0; let upper = Math.max(1, 1 / minWeight);
  for (let index = 0; index < 100; index += 1) {
    const scale = (lower + upper) / 2;
    const total = weights.reduce((sum, weight) => sum + clamp(weight * scale), 0);
    if (total < rows.length) lower = scale; else upper = scale;
  }
  const scale = (lower + upper) / 2;
  let trimmed = 0;
  rows.forEach((row, index) => {
    const scaled = weights[index] * scale;
    row.__weight = clamp(scaled);
    if (row.__weight !== scaled) trimmed += 1;
  });
  return trimmed;
}

/** @param {DataRow[]} rows @param {WeightTarget[]} targets @param {WeightOptions} [options] */
export function calculateRimWeights(rows, targets, options = {}) {
  if (!rows.length) throw new WeightingInputError("数据集没有可加权样本。", "WEIGHT_DATA_EMPTY");
  const maximumIterations = Math.min(100, Math.max(1, Math.round(Number(options.max_iterations) || 30))); const tolerance = Math.min(0.01, Math.max(0.000001, Number(options.tolerance) || 0.0001));
  const trimMin = options.trim?.min == null ? null : finite(options.trim.min); const trimMax = options.trim?.max == null ? null : finite(options.trim.max);
  if ((options.trim?.min != null && trimMin == null) || (options.trim?.max != null && trimMax == null) || (trimMin != null && trimMin <= 0) || (trimMax != null && trimMax <= 0) || (trimMin != null && trimMax != null && trimMin >= trimMax)) throw new WeightingInputError("权重截尾范围无效。", "WEIGHT_TRIM_INVALID");
  if ((trimMin != null && trimMin > 1) || (trimMax != null && trimMax < 1)) throw new WeightingInputError("最终权重均值为 1，截尾范围必须包含 1。", "WEIGHT_TRIM_INVALID");
  /** @type {(DataRow & {__weight:number})[]} */
  const weightedRows = rows.map((row) => ({ ...row, __weight: 1 })); let maxDelta = Infinity; let iteration = 0; let converged = false;
  for (iteration = 1; iteration <= maximumIterations; iteration += 1) {
    for (const target of targets) { const total = weightedRows.reduce((sum, row) => sum + row.__weight, 0); for (const category of target.categories) { const current = weightedRows.filter((row) => text(row[target.variable]) === category.value).reduce((sum, row) => sum + row.__weight, 0); if (!current || !total) throw new WeightingInputError(`加权类别 ${target.variable}=${category.value} 没有有效样本。`, "WEIGHT_EMPTY_CELL"); const factor = category.share / (current / total); weightedRows.forEach((row) => { if (text(row[target.variable]) === category.value) row.__weight *= factor; }); } }
    const average = weightedRows.reduce((sum, row) => sum + row.__weight, 0) / weightedRows.length; weightedRows.forEach((row) => { row.__weight /= average; }); const total = weightedRows.reduce((sum, row) => sum + row.__weight, 0); maxDelta = 0;
    for (const target of targets) for (const category of target.categories) { const actual = weightedRows.filter((row) => text(row[target.variable]) === category.value).reduce((sum, row) => sum + row.__weight, 0) / total; maxDelta = Math.max(maxDelta, Math.abs(actual - category.share)); }
    if (maxDelta <= tolerance) { converged = true; break; }
  }
  let trimmed = 0;
  if (trimMin != null || trimMax != null) trimmed = boundedNormalize(weightedRows, trimMin, trimMax);
  // Convergence must describe the exported weights, including any trimming.
  const finalTotal = weightedRows.reduce((sum, row) => sum + row.__weight, 0);
  maxDelta = 0;
  for (const target of targets) for (const category of target.categories) {
    const actual = weightedRows.reduce((sum, row) => sum + (text(row[target.variable]) === category.value ? row.__weight : 0), 0) / finalTotal;
    maxDelta = Math.max(maxDelta, Math.abs(actual - category.share));
  }
  converged = maxDelta <= tolerance;
  return { rows: weightedRows, diagnostics: { ...diagnostics(weightedRows, targets, Math.min(iteration, maximumIterations), converged, maxDelta, trimmed), trim_scope: "final_normalized_weights", convergence_note: converged ? "最终权重已达到目标边际分布。" : "最终权重未达到目标边际分布，请检查残差、截尾范围或增加迭代次数。" } };
}

/** @param {(DataRow & {__weight?:number})[]} rows @param {string} variable */
export function weightedNps(rows, variable) { const valid = rows.map((row) => ({ score: finite(row[variable]), weight: finite(row.__weight) })).filter((item) => item.score != null && item.score >= 0 && item.score <= 10 && item.weight != null && item.weight > 0); const weight = valid.reduce((sum, item) => sum + /** @type {number} */ (item.weight), 0); if (!weight) return null; return { value: rounded(valid.reduce((sum, item) => sum + (((/** @type {number} */ (item.score) >= 9) ? 1 : (/** @type {number} */ (item.score) <= 6) ? -1 : 0) * /** @type {number} */ (item.weight)), 0) / weight * 100, 1), base: valid.length, weighted_base: rounded(weight, 2) }; }

/** @param {(DataRow & {__weight?:number})[]} rows @param {string} variable */
export function weightedMean(rows, variable) { const valid = rows.map((row) => ({ value: finite(row[variable]), weight: finite(row.__weight) })).filter((item) => item.value != null && item.weight != null && item.weight > 0); const weight = valid.reduce((sum, item) => sum + /** @type {number} */ (item.weight), 0); return weight ? { value: rounded(valid.reduce((sum, item) => sum + /** @type {number} */ (item.value) * /** @type {number} */ (item.weight), 0) / weight), base: valid.length, weighted_base: rounded(weight, 2) } : null; }
