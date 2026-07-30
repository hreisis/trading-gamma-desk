import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reportPath = "fixtures/macro/calibration/report-2026-07-29.json";

describe("calibration report (M1-6b report-only)", () => {
  it("is present and commit-safe", () => {
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      kind: string;
      sample: { dayCount: number; note: string };
      fallbackFrequency: Record<string, number>;
      scenarioConstraints: { results: { ok: boolean }[] };
      parameterSuggestions: {
        status: string;
        calibratedRemains: boolean;
        items: unknown[];
      };
    };

    expect(report.kind).toBe("MacroCalibrationReport");
    expect(report.sample.dayCount).toBeGreaterThan(0);
    expect(report.parameterSuggestions.status).toBe("review_only");
    expect(report.parameterSuggestions.calibratedRemains).toBe(false);
    expect(
      report.scenarioConstraints.results.every((r) => r.ok),
    ).toBe(true);
    expect(report.sample.note.toLowerCase()).toMatch(/no tiingo raw/);
  });

  it("does not embed Tiingo raw prints or bar arrays", () => {
    const text = readFileSync(reportPath, "utf8");
    expect(text).not.toMatch(/"bars"\s*:/);
    expect(text).not.toMatch(/tiingo\/daily/);
    expect(text).not.toMatch(/adjClose/);
  });

  it("separately counts the three fallback regimes", () => {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      fallbackFrequency: {
        mixed_unresolved: number;
        single_asset_shock: number;
        insufficient_data: number;
      };
    };
    expect(report.fallbackFrequency).toEqual(
      expect.objectContaining({
        mixed_unresolved: expect.any(Number),
        single_asset_shock: expect.any(Number),
        insufficient_data: expect.any(Number),
      }),
    );
  });
});
