import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { inspectResearchWorkbook } from "./file-parser.js";


const fixtureRoot = new URL("../../tests/fixtures/imports/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8"));

function fixtureBuffer(name) {
  const bytes = readFileSync(fileURLToPath(new URL(name, fixtureRoot)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("unified research workbook parser", () => {
  manifest.fixtures.forEach((fixture) => {
    it(`recognizes ${fixture.file}`, async () => {
      const inspection = await inspectResearchWorkbook(fixtureBuffer(fixture.file));
      expect(inspection.version).toBe("surveykit_import_inspection_v1");
      expect(inspection.format).toBe(fixture.format);
      expect(inspection.metrics.question_count).toBe(fixture.questions);
      expect(inspection.metrics.dimension_count).toBeGreaterThanOrEqual(fixture.min_dimensions);
      expect(inspection.status).not.toBe("error");
      expect(inspection.sheets.length).toBeGreaterThan(0);
    });
  });

  it("rejects raw survey data on the PPT crosstab upload surface with an actionable reason", async () => {
    const inspection = await inspectResearchWorkbook(fixtureBuffer("raw-survey.xlsx"), { target: "pptx_crosstab" });
    expect(inspection.status).toBe("error");
    expect(inspection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "PPTX_REQUIRES_CROSSTAB",
        action: expect.stringContaining("交叉表分析"),
      }),
    ]));
  });

  it("never returns a silent zero-question result", async () => {
    const inspection = await inspectResearchWorkbook(fixtureBuffer("raw-survey.xlsx"));
    expect(inspection.metrics.question_count).toBeGreaterThan(0);
    if (inspection.metrics.dimension_count === 0) {
      expect(inspection.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("returns an actionable diagnosis instead of a silent zero result", async () => {
    const inspection = await inspectResearchWorkbook(fixtureBuffer("unknown-layout.xlsx"), { target: "pptx_crosstab" });
    expect(inspection.status).toBe("error");
    expect(inspection.metrics.question_count).toBe(0);
    expect(inspection.metrics.dimension_count).toBe(0);
    expect(inspection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        action: expect.stringMatching(/请|上传|检查|保留/),
      }),
    ]));
  });
});
