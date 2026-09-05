import { requireFiniteNumber } from "./errors.mjs";

export const SAMPLE_SIZE_TOOL_ID = "sample-size";

export function calculateSampleSize(input = {}) {
  const z = requireFiniteNumber(input.z ?? input.confidence_level ?? 1.96, "置信水平", { minimum: 0, maximum: 10, exclusiveMinimum: true });
  const marginPercent = requireFiniteNumber(input.marginPercent ?? input.margin_of_error ?? 5, "允许误差", { minimum: 0, maximum: 100, exclusiveMinimum: true });
  const population = requireFiniteNumber(input.population ?? 0, "用户规模", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  const segments = requireFiniteNumber(input.segments ?? 1, "分群数量", { minimum: 1, maximum: 100_000 });
  const responseRatePercent = requireFiniteNumber(input.responseRatePercent ?? input.response_rate ?? 80, "预计有效回收率", { minimum: 0, maximum: 100, exclusiveMinimum: true });
  const margin = marginPercent / 100;
  const responseRate = responseRatePercent / 100;
  const p = 0.5;

  const infiniteSample = (z * z * p * (1 - p)) / (margin * margin);
  const adjustedSample = population > 0
    ? infiniteSample / (1 + (infiniteSample - 1) / population)
    : infiniteSample;
  const base = Math.ceil(adjustedSample);
  const segment = Math.ceil(base / Math.max(1, segments));
  const gross = Math.ceil(base / responseRate);
  const populationText = population > 0 ? `用户规模 ${population.toLocaleString("zh-CN")}、` : "用户规模不设上限、";
  const advice = `${populationText}允许误差 ${Math.round(margin * 100)}% 时，建议至少回收 ${base.toLocaleString("zh-CN")} 个有效样本；按当前回收率预估需发放 ${gross.toLocaleString("zh-CN")} 份。`;

  return { base, gross, segment, advice };
}
