/**
 * 交叉表分析模块测试
 */
import { describe, it, expect } from "vitest";
import {
  buildCrosstab,
  computeColumnPercents,
  computeRowPercents,
  significanceLevel,
  cramersV,
  effectSizeLabel,
  columnProportionPostHoc,
  crosstabToSvgChart,
  crosstabToExportRows,
  questionPrefix
} from "../../src/modules/crosstab/index.js";

const sampleData = [
  { gender: "男", brand: "A" },
  { gender: "男", brand: "A" },
  { gender: "男", brand: "B" },
  { gender: "女", brand: "A" },
  { gender: "女", brand: "B" },
  { gender: "女", brand: "B" },
  { gender: "女", brand: "B" },
  { gender: "男", brand: "B" },
];

describe("crosstab", () => {
  describe("buildCrosstab", () => {
    it("builds a contingency table", () => {
      const result = buildCrosstab(sampleData, "gender", "brand");
      expect(result.rowLabels).toEqual(["男", "女"]);
      expect(result.colLabels).toEqual(["A", "B"]);
      expect(result.total).toBe(8);
      expect(result.matrix[0]).toEqual([2, 2]); // 男: A=2, B=2
      expect(result.matrix[1]).toEqual([1, 3]); // 女: A=1, B=3
    });

    it("computes chi-square and p-value", () => {
      const result = buildCrosstab(sampleData, "gender", "brand");
      expect(result.chiSquare).toBeGreaterThan(0);
      expect(result.degreesOfFreedom).toBe(1);
      expect(result.pValue).toBeGreaterThan(0);
      expect(result.pValue).toBeLessThan(1);
    });
  });

  describe("computeColumnPercents", () => {
    it("computes column percentages", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const percents = computeColumnPercents(analysis);
      // 品牌A: 男2/3, 女1/3
      expect(percents[0][0]).toBeCloseTo(2 / 3, 4);
      expect(percents[1][0]).toBeCloseTo(1 / 3, 4);
    });
  });

  describe("computeRowPercents", () => {
    it("computes row percentages", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const percents = computeRowPercents(analysis);
      // 男: A=2/4=0.5, B=2/4=0.5
      expect(percents[0][0]).toBeCloseTo(0.5, 4);
      expect(percents[0][1]).toBeCloseTo(0.5, 4);
    });
  });

  describe("significanceLevel", () => {
    it("classifies significance levels", () => {
      expect(significanceLevel(0.0001).level).toBe("0.001");
      expect(significanceLevel(0.005).level).toBe("0.01");
      expect(significanceLevel(0.03).level).toBe("0.05");
      expect(significanceLevel(0.1).level).toBe("ns");
      expect(significanceLevel(null).level).toBe("na");
    });
  });

  describe("cramersV", () => {
    it("computes effect size", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const v = cramersV(analysis);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });

    it("returns 0 for no association", () => {
      // Perfect independence
      const data = [
        { r: "a", c: "x" }, { r: "a", c: "y" },
        { r: "b", c: "x" }, { r: "b", c: "y" },
      ];
      const analysis = buildCrosstab(data, "r", "c");
      expect(cramersV(analysis)).toBeCloseTo(0, 4);
    });
  });

  describe("effectSizeLabel", () => {
    it("labels effect sizes", () => {
      expect(effectSizeLabel(0.05)).toBe("可忽略");
      expect(effectSizeLabel(0.2)).toBe("小效应");
      expect(effectSizeLabel(0.4)).toBe("中等效应");
      expect(effectSizeLabel(0.6)).toBe("大效应");
    });
  });

  describe("columnProportionPostHoc", () => {
    it("returns pairwise comparisons", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const results = columnProportionPostHoc(analysis, 0);
      expect(results.length).toBe(1); // 2 columns → 1 pair
      expect(results[0]).toHaveProperty("z");
      expect(results[0]).toHaveProperty("significant");
    });
  });

  describe("crosstabToSvgChart", () => {
    it("generates valid SVG string", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const svg = crosstabToSvgChart(analysis, { title: "测试图表" });
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("测试图表");
    });
  });

  describe("crosstabToExportRows", () => {
    it("generates exportable rows", () => {
      const analysis = buildCrosstab(sampleData, "gender", "brand");
      const rows = crosstabToExportRows(analysis);
      expect(rows[0]).toEqual(["", "A", "B", "合计"]);
      expect(rows.length).toBe(4); // header + 2 data + total
    });
  });

  describe("questionPrefix", () => {
    it("extracts question prefix", () => {
      expect(questionPrefix("Q1 您的年龄")).toBe("Q1");
      expect(questionPrefix("RS2__1 满意度")).toBe("RS2");
      expect(questionPrefix("无题号")).toBe("");
    });
  });
});
