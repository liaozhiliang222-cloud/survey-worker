/**
 * 统计函数模块测试
 */
import { describe, it, expect } from "vitest";
import {
  gammaLog,
  gammaP,
  chiSquarePValue,
  mean,
  median,
  standardDeviation,
  modeValue,
  formatPercent,
  toNumberOrNull
} from "../../src/shared/stats.js";

describe("stats", () => {
  describe("gammaLog", () => {
    it("computes log-gamma for positive values", () => {
      expect(gammaLog(1)).toBeCloseTo(0, 5);
      expect(gammaLog(2)).toBeCloseTo(0, 5);
      expect(gammaLog(5)).toBeCloseTo(Math.log(24), 4);
    });
  });

  describe("gammaP", () => {
    it("returns 0 for x <= 0", () => {
      expect(gammaP(1, 0)).toBe(0);
      expect(gammaP(1, -1)).toBe(0);
    });

    it("approaches 1 for large x", () => {
      expect(gammaP(1, 10)).toBeCloseTo(1, 4);
    });
  });

  describe("chiSquarePValue", () => {
    it("returns null for invalid inputs", () => {
      expect(chiSquarePValue(NaN, 1)).toBeNull();
      expect(chiSquarePValue(5, 0)).toBeNull();
      expect(chiSquarePValue(5, -1)).toBeNull();
    });

    it("returns value between 0 and 1", () => {
      const p = chiSquarePValue(3.84, 1);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      expect(p).toBeCloseTo(0.05, 1);
    });

    it("returns small p for large chi-square", () => {
      const p = chiSquarePValue(100, 5);
      expect(p).toBeLessThan(0.001);
    });
  });

  describe("mean", () => {
    it("returns null for empty array", () => {
      expect(mean([])).toBeNull();
    });

    it("computes arithmetic mean", () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
      expect(mean([10, 20])).toBe(15);
    });
  });

  describe("median", () => {
    it("returns null for empty array", () => {
      expect(median([])).toBeNull();
    });

    it("computes median for odd length", () => {
      expect(median([3, 1, 2])).toBe(2);
    });

    it("computes median for even length", () => {
      expect(median([4, 1, 3, 2])).toBe(2.5);
    });
  });

  describe("standardDeviation", () => {
    it("returns 0 for single element", () => {
      expect(standardDeviation([5])).toBe(0);
    });

    it("computes sample standard deviation", () => {
      const sd = standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(sd).toBeCloseTo(2.138, 2);
    });
  });

  describe("modeValue", () => {
    it("returns null for empty array", () => {
      expect(modeValue([])).toBeNull();
    });

    it("returns most frequent value", () => {
      expect(modeValue([1, 2, 2, 3])).toBe(2);
      expect(modeValue(["a", "b", "b", "c"])).toBe("b");
    });
  });

  describe("formatPercent", () => {
    it("formats as percentage string", () => {
      expect(formatPercent(0.456)).toBe("45.6%");
      expect(formatPercent(0.5, 0)).toBe("50%");
      expect(formatPercent(1)).toBe("100.0%");
    });
  });

  describe("toNumberOrNull", () => {
    it("parses valid numbers", () => {
      expect(toNumberOrNull("42")).toBe(42);
      expect(toNumberOrNull("3.14")).toBe(3.14);
      expect(toNumberOrNull(" 7 ")).toBe(7);
    });

    it("returns null for invalid inputs", () => {
      expect(toNumberOrNull("")).toBeNull();
      expect(toNumberOrNull("abc")).toBeNull();
      expect(toNumberOrNull(null)).toBeNull();
      expect(toNumberOrNull(undefined)).toBeNull();
    });
  });
});
