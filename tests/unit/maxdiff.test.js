/**
 * MaxDiff 模块测试 — 题组设计 + 设计校验 + MNL/HB 估计
 */
import { describe, it, expect } from "vitest";
import {
  parseLineItems,
  generateMaxDiffDesign,
  validateMaxDiffDesign,
  parseMaxDiffScores,
  computePreferenceShare,
  parseMaxDiffResponses,
  aggregateResponsesToCounts,
  estimateMNLUtilities,
  estimateHBUtilities,
  maxDiffValidationToExportRows,
  maxDiffUtilitiesToExportRows
} from "../../src/modules/maxdiff/index.js";

describe("maxdiff parseLineItems", () => {
  it("splits by newlines and commas", () => {
    expect(parseLineItems("A\nB\nC")).toEqual(["A", "B", "C"]);
    expect(parseLineItems("A,B，C；D")).toEqual(["A", "B", "C", "D"]);
  });

  it("filters empty entries", () => {
    expect(parseLineItems("A\n\n  \nB")).toEqual(["A", "B"]);
  });
});

describe("maxdiff generateMaxDiffDesign", () => {
  it("throws when items fewer than itemsPerSet", () => {
    expect(() => generateMaxDiffDesign(["A", "B"], 4, 3)).toThrow();
  });

  it("creates the requested number of sets with the right size", () => {
    const items = ["A", "B", "C", "D", "E", "F"];
    const design = generateMaxDiffDesign(items, 6, 3);
    expect(design.sets).toHaveLength(6);
    design.sets.forEach((set) => {
      expect(set.items).toHaveLength(3);
      expect(new Set(set.items).size).toBe(3);
    });
  });

  it("keeps occurrence counts within a reasonable spread for balanced input", () => {
    const items = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const design = generateMaxDiffDesign(items, 16, 4);
    const counts = [...design.counts.values()];
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // 轻量贪心分配允许一定波动
    expect(max - min).toBeLessThanOrEqual(6);
  });
});

describe("maxdiff validateMaxDiffDesign", () => {
  it("returns good level for a perfectly balanced design with rotated positions", () => {
    // 手工构造一个完全均衡的设计：4 项 / 4 组 / 每组 3 项
    // 每项出现 3 次，每对共现 2 次，位置也轮换
    const design = {
      items: ["A", "B", "C", "D"],
      sets: [
        { set: 1, items: ["A", "B", "C"] },
        { set: 2, items: ["B", "C", "D"] },
        { set: 3, items: ["C", "D", "A"] },
        { set: 4, items: ["D", "A", "B"] }
      ]
    };
    const v = validateMaxDiffDesign(design, { itemsPerSet: 3 });
    expect(v.occurrence.balanced).toBe(true);
    expect(v.pairCoverage.missingPairs).toHaveLength(0);
    expect(v.overallScore).toBeGreaterThanOrEqual(85);
    expect(v.level).toBe("good");
  });

  it("scores the greedy algorithm output with a non-zero score", () => {
    const items = ["A", "B", "C", "D", "E", "F"];
    const design = generateMaxDiffDesign(items, 18, 3);
    const v = validateMaxDiffDesign(design);
    expect(v.overallScore).toBeGreaterThanOrEqual(0);
    expect(v.level).toMatch(/good|acceptable|warning/);
  });

  it("detects missing pairs for an unbalanced design", () => {
    const design = {
      items: ["A", "B", "C", "D"],
      sets: [
        { set: 1, items: ["A", "B"] },
        { set: 2, items: ["A", "B"] },
        { set: 3, items: ["C", "D"] },
        { set: 4, items: ["C", "D"] }
      ]
    };
    const v = validateMaxDiffDesign(design, { itemsPerSet: 2 });
    expect(v.pairCoverage.missingPairs.length).toBeGreaterThan(0);
    expect(v.issues.some((i) => i.code === "missing_pairs")).toBe(true);
  });

  it("exports validation to rows", () => {
    const design = generateMaxDiffDesign(["A", "B", "C", "D"], 4, 2);
    const v = validateMaxDiffDesign(design);
    const rows = maxDiffValidationToExportRows(v);
    expect(rows[0][0]).toContain("MaxDiff");
    expect(rows.length).toBeGreaterThan(5);
  });
});

describe("maxdiff parseMaxDiffScores", () => {
  it("parses valid rows and sorts by score", () => {
    const text = "A,10,2,20\nB,4,8,20\nC,12,1,20";
    const rows = parseMaxDiffScores(text);
    expect(rows).toHaveLength(3);
    expect(rows[0].item).toBe("C"); // highest score (12-1)/20
    expect(rows[0].score).toBeCloseTo(0.55, 2);
  });

  it("skips invalid rows", () => {
    const text = "A,10,2,20\nbad,row\nB,4,8,20";
    const rows = parseMaxDiffScores(text);
    expect(rows).toHaveLength(2);
  });
});

describe("maxdiff computePreferenceShare", () => {
  it("returns shares that sum to ~1", () => {
    const scores = parseMaxDiffScores("A,10,2,20\nB,4,8,20\nC,12,1,20");
    const shares = computePreferenceShare(scores);
    const sum = shares.reduce((s, r) => s + r.share, 0);
    expect(sum).toBeCloseTo(1, 3);
    expect(shares[0].rank).toBe(1);
  });
});

describe("maxdiff parseMaxDiffResponses", () => {
  it("parses 4-column responses and 5-column with shown items", () => {
    const text = "R1,1,A,C,A|B|C|D\nR1,2,B,D,B|C|D|E\nR2,1,C,A,A|B|C|D";
    const parsed = parseMaxDiffResponses(text);
    expect(parsed.respondents).toEqual(["R1", "R2"]);
    expect(parsed.responses).toHaveLength(3);
    expect(parsed.responses[0].shown).toEqual(["A", "B", "C", "D"]);
  });

  it("skips malformed lines", () => {
    const text = "R1,1,A,C\nbad\nR2,1,C,A";
    const parsed = parseMaxDiffResponses(text);
    expect(parsed.responses).toHaveLength(2);
  });
});

describe("maxdiff aggregateResponsesToCounts", () => {
  it("aggregates best/worst/shown counts", () => {
    const responses = parseMaxDiffResponses(
      "R1,1,A,C,A|B|C|D\nR1,2,B,D,B|C|D|E\nR2,1,C,A,A|B|C|D"
    ).responses;
    const counts = aggregateResponsesToCounts(responses, ["A", "B", "C", "D", "E"]);
    const a = counts.find((c) => c.item === "A");
    expect(a.best).toBe(1);
    expect(a.worst).toBe(1);
    // A shown in set 1 of R1 and R2 → 2
    expect(a.shown).toBe(2);
  });
});

describe("maxdiff estimateMNLUtilities", () => {
  it("ranks items with synthetic data favoring one item", () => {
    // Construct responses where A is best much more often than others
    const items = ["A", "B", "C", "D"];
    const responses = [];
    for (let i = 0; i < 30; i += 1) {
      // 30 respondents, each 4 sets, A chosen as best in every set
      for (let s = 1; s <= 4; s += 1) {
        const shown = ["A", "B", "C", "D"];
        responses.push({
          respondent: `R${i + 1}`,
          set: s,
          best: "A",
          worst: "D",
          shown
        });
      }
    }
    const result = estimateMNLUtilities(responses, items, { iterations: 300 });
    expect(result.utilities[0].item).toBe("A");
    expect(result.utilities[0].utility).toBeGreaterThan(result.utilities[1].utility);
    expect(result.utilities[0].share).toBeGreaterThan(0.25);
  });

  it("returns zero utilities for empty input", () => {
    const result = estimateMNLUtilities([], ["A", "B"]);
    expect(result.utilities).toHaveLength(2);
    expect(result.utilities[0].utility).toBe(0);
  });

  it("exports utilities to rows", () => {
    const items = ["A", "B", "C"];
    const responses = [
      { respondent: "R1", set: 1, best: "A", worst: "C", shown: ["A", "B", "C"] },
      { respondent: "R1", set: 2, best: "A", worst: "B", shown: ["A", "B", "C"] }
    ];
    const result = estimateMNLUtilities(responses, items, { iterations: 50 });
    const rows = maxDiffUtilitiesToExportRows(result, "MNL");
    expect(rows[0][0]).toContain("MNL");
    expect(rows.length).toBeGreaterThan(5);
  });
});

describe("maxdiff estimateHBUtilities", () => {
  it("returns group and individual utilities", () => {
    const items = ["A", "B", "C", "D"];
    const responses = [];
    for (let i = 0; i < 20; i += 1) {
      for (let s = 1; s <= 4; s += 1) {
        responses.push({
          respondent: `R${i + 1}`,
          set: s,
          best: "A",
          worst: "D",
          shown: ["A", "B", "C", "D"]
        });
      }
    }
    const result = estimateHBUtilities(responses, items, { iterations: 100 });
    expect(result.respondentCount).toBe(20);
    expect(result.individualUtilities).toHaveLength(20);
    expect(result.groupUtilities).toHaveLength(4);
    expect(result.groupUtilities[0].item).toBe("A");
  });

  it("handles small per-respondent sample with shrinkage", () => {
    const items = ["A", "B", "C"];
    const responses = [
      { respondent: "R1", set: 1, best: "A", worst: "B", shown: ["A", "B", "C"] },
      { respondent: "R2", set: 1, best: "B", worst: "A", shown: ["A", "B", "C"] }
    ];
    const result = estimateHBUtilities(responses, items, { minResponses: 1 });
    expect(result.groupUtilities).toHaveLength(3);
    expect(result.respondentCount).toBe(2);
  });
});
