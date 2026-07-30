import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MacroSymbol } from "@/contracts";

const summary = JSON.parse(
  readFileSync(
    "fixtures/macro/history/snapshot-2026-07-29.summary.json",
    "utf8",
  ),
) as {
  marketSessionDate: string;
  primaryRegime: string;
  polarity: string | null;
  confidenceScore: number;
  calibrated: boolean;
  isCompleteSession: boolean;
};

const TIINGO_SYMBOLS: MacroSymbol[] = [
  "GOLD",
  "COPPER",
  "OIL",
  "USD",
  "BTC",
];

const PUBLIC_SYMBOLS: MacroSymbol[] = ["US2Y", "US10Y", "VIX"];

describe("frozen history stays publishable (M1-7)", () => {
  it("records the live classification summary without band labels", () => {
    expect(summary.marketSessionDate).toBe("2026-07-29");
    expect(summary.isCompleteSession).toBe(true);
    expect(summary.primaryRegime).toBe("inflation");
    expect(summary.polarity).toBe("positive");
    expect(summary.confidenceScore).toBe(68);
    expect(summary.calibrated).toBe(false);
  });

  it("keeps only public-source series in the committed freeze", () => {
    for (const symbol of PUBLIC_SYMBOLS) {
      const path = `fixtures/macro/history/${symbol}.json`;
      expect(existsSync(path), path).toBe(true);
      const series = JSON.parse(readFileSync(path, "utf8")) as {
        source: string;
        bars: { sessionDate: string }[];
      };
      expect(series.bars.length).toBeGreaterThanOrEqual(45);
      expect(series.bars.at(-1)!.sessionDate).toBe(summary.marketSessionDate);
      expect(series.source.includes("tiingo")).toBe(false);
    }
  });

  it("does not ship Tiingo-licensed raw history in the public tree", () => {
    for (const symbol of TIINGO_SYMBOLS) {
      expect(
        existsSync(`fixtures/macro/history/${symbol}.json`),
        `${symbol} must not be committed`,
      ).toBe(false);
    }

    const readme = JSON.parse(
      readFileSync("fixtures/macro/history/README.json", "utf8"),
    ) as { excludedFromPublicRepo: string[] };
    expect(readme.excludedFromPublicRepo).toEqual(
      expect.arrayContaining(TIINGO_SYMBOLS),
    );
  });
});
