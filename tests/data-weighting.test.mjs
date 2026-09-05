import { describe, expect, it } from "vitest";
import { finiteDataNumber } from "../lib/data-values.mjs";
import { calculateRimWeights, normalizeWeightTargets, weightedMean, weightedNps } from "../lib/data-weighting.mjs";

describe("survey numeric values", () => {
  it.each([null, undefined, "", "  ", "\t", NaN, Infinity, "not a number", false, [], {}])("treats %j as missing", (value) => {
    expect(finiteDataNumber(value)).toBeNull();
  });
  it.each([0, "0", " 0 "])("preserves genuine zero %j", (value) => {
    expect(finiteDataNumber(value)).toBe(0);
  });
  it("uses valid answers only for weighted mean and NPS", () => {
    const rows = [10, null, "", "  ", undefined].map((v) => ({ v, __weight: 1 }));
    expect(weightedNps(rows, "v")).toEqual({ value: 100, base: 1, weighted_base: 1 });
    expect(weightedMean(rows, "v")).toEqual({ value: 10, base: 1, weighted_base: 1 });
    rows.push({ v: 0, __weight: 1 });
    expect(weightedNps(rows, "v")).toEqual({ value: 0, base: 2, weighted_base: 2 });
    expect(weightedMean(rows, "v")).toEqual({ value: 5, base: 2, weighted_base: 2 });
  });
  it("returns no score when every answer is missing", () => {
    const rows = [null, "", undefined].map((v) => ({ v, __weight: 1 }));
    expect(weightedNps(rows, "v")).toBeNull();
    expect(weightedMean(rows, "v")).toBeNull();
  });
});

describe("final RIM diagnostics and bounds", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ group: i < 9 ? "A" : "B" }));
  const targets = normalizeWeightTargets([{ variable: "group", categories: [{ value: "A", share: 50 }, { value: "B", share: 50 }] }], ["group"], rows);
  it("matches the hand-calculated 50/50 untrimmed solution", () => {
    const result = calculateRimWeights(rows, targets);
    expect(result.rows[0].__weight).toBeCloseTo(5 / 9, 10);
    expect(result.rows[9].__weight).toBeCloseTo(5, 10);
    expect(result.diagnostics.converged).toBe(true);
    expect(result.diagnostics.max_margin_delta).toBe(0);
    expect(rows.every((row) => !("__weight" in row))).toBe(true);
  });
  it("keeps final weights within bounds and recomputes residuals", () => {
    const result = calculateRimWeights(rows, targets, { trim: { min: 0.5, max: 2 } });
    expect(result.rows[0].__weight).toBeCloseTo(8 / 9, 10);
    expect(result.rows[9].__weight).toBe(2);
    expect(result.rows.reduce((sum, row) => sum + row.__weight, 0)).toBeCloseTo(10, 10);
    expect(result.diagnostics.max_weight).toBe(2);
    expect(result.diagnostics.converged).toBe(false);
    expect(result.diagnostics.max_margin_delta).toBeCloseTo(0.3, 8);
    expect(result.diagnostics.margins.map((item) => item.weighted_share)).toEqual([0.8, 0.2]);
    expect(result.diagnostics.convergence_note).toContain("未达到");
  });
  it("does not report nonconvergence for inactive bounds", () => {
    const result = calculateRimWeights(rows, targets, { trim: { min: 0.1, max: 6 } });
    expect(result.diagnostics.converged).toBe(true);
    expect(result.diagnostics.max_margin_delta).toBe(0);
  });
  it.each([{ min: 1 }, { max: 1 }])("handles mean-one boundary %j", (trim) => {
    const result = calculateRimWeights(rows, targets, { trim });
    result.rows.forEach((row) => expect(row.__weight).toBeCloseTo(1, 10));
    expect(result.diagnostics.converged).toBe(false);
  });
  it.each([{ min: 1.1 }, { max: 0.9 }, { min: "" }, { max: "bad" }, { min: 0 }, { min: 2, max: 1 }])("rejects invalid final bounds %j", (trim) => {
    expect(() => calculateRimWeights(rows, targets, { trim })).toThrowError(expect.objectContaining({ code: "WEIGHT_TRIM_INVALID" }));
  });
});
