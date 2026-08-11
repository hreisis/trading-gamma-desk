import { describe, expect, it } from "vitest";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import type { DailyBar } from "@/desk/breadth/bars/types";
import {
  closesEndingAtTarget,
  computeSpyBreadthInternals,
} from "@/desk/breadth/compute/breadth";
import {
  BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION,
  BREADTH_INTERNALS_SCHEMA_VERSION,
  isLegacyBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import { parseStoredBreadthSnapshotJson } from "@/desk/breadth/store/parse";
import {
  legacyStoredSnapshotJson,
  samplePublishableBreadthSnapshot,
} from "./helpers/breadth-fixtures";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import {
  clampRecentBreadthSnapshotLimit,
  dedupeBreadthSnapshotsBySession,
} from "@/desk/breadth/store/history";

function sampleRows(): string[][] {
  return [
    ["Fund Name:", "State Street® SPDR® S&P 500® ETF Trust"],
    ["Ticker Symbol:", "SPY"],
    ["Holdings:", "As of 05-Aug-2026"],
    ["Name", "Ticker", "Identifier", "Weight", "Sector", "Shares Held", "Local Currency"],
    ["NVIDIA CORP", "NVDA", "67066G104", "7.99", "-", "100", "USD"],
    ["BERKSHIRE HATHAWAY INC CL B", "BRK.B", "084670702", "1.44", "-", "10", "USD"],
    ["BROWN FORMAN CORP CL B", "BF.B", "115637209", "0.01", "-", "1", "USD"],
  ];
}

function baseUniverse(): EtfUniverseArtifact {
  return parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: "2026-08-06T12:00:00.000Z",
  });
}

function tradingDaysEndingAt(endDate: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${endDate}T12:00:00.000Z`);
  while (days.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(iso);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

function barSeries(
  symbol: string,
  closes: Array<{ date: string; close: number }>,
) {
  return {
    symbol,
    updatedAt: "2026-08-06T12:00:00.000Z",
    bars: closes.map((row) => ({
      sessionDate: row.date,
      open: row.close,
      high: row.close + 1,
      low: row.close - 1,
      close: row.close,
      volume: 1_000,
    })),
  };
}

function computeBreadth(input: {
  universe?: EtfUniverseArtifact;
  targetMarketSessionDate?: string;
  seriesBySymbol: Map<string, ReturnType<typeof barSeries>>;
}) {
  const universe = input.universe ?? baseUniverse();
  const target = input.targetMarketSessionDate ?? "2026-08-06";
  return computeSpyBreadthInternals({
    universe: { ...universe, sessionLag: 0, stale: false, status: "available" },
    targetMarketSessionDate: target,
    asOf: `${target}T16:00:00.000Z`,
    seriesBySymbol: input.seriesBySymbol,
    barsProvenance: {
      provider: "alpaca",
      priceFeed: "iex",
      isConsolidated: false,
      adjustment: "split",
      requestedSymbols: input.seriesBySymbol.size,
      returnedSymbols: input.seriesBySymbol.size,
      coverage: 1,
      pages: 1,
      fetchedAt: `${target}T16:00:00.000Z`,
      latestSessionDate: target,
      failedSymbols: [],
    },
  });
}

describe("closesEndingAtTarget", () => {
  it("includes the target session close in the MA window", () => {
    const target = "2026-08-06";
    const days = tradingDaysEndingAt(target, 20);
    const bars: DailyBar[] = days.map((sessionDate, index) => ({
      sessionDate,
      open: index,
      high: index + 1,
      low: index - 1,
      close: index === days.length - 1 ? 110 : 100,
      volume: 1,
    }));

    const closes = closesEndingAtTarget(bars, target, 20);
    expect(closes).toHaveLength(20);
    expect(closes.at(-1)).toBe(110);
    const ma = closes.reduce((sum, value) => sum + value, 0) / closes.length;
    expect(ma).toBeCloseTo(100.5, 5);
  });
});

describe("MA metrics include current session close", () => {
  it("eligibility uses 20 inclusive closes and compares target close to inclusive SMA", () => {
    const target = "2026-08-06";
    const days = tradingDaysEndingAt(target, 20);
    const closes = days.map((date, index) => ({
      date,
      close: index === days.length - 1 ? 110 : 100,
    }));

    const breadth = computeBreadth({
      seriesBySymbol: new Map([
        ["NVDA", barSeries("NVDA", closes)],
        ["BRK.B", barSeries("BRK.B", closes)],
        ["BF.B", barSeries("BF.B", closes)],
      ]),
      targetMarketSessionDate: target,
    });

    expect(breadth.schemaVersion).toBe("0.2.0");
    expect(breadth.metrics.percentAboveMA20.eligibleCount).toBe(3);
    expect(breadth.metrics.percentAboveMA20.numerator).toBe(3);
    expect(breadth.metrics.percentAboveMA20.status).toBe("available");
    expect(breadth.coverage.ma20Coverage).toBe(1);
  });
});

describe("20D closing high/low definition", () => {
  it("flags new closing high when target close exceeds prior 19 closes", () => {
    const target = "2026-08-06";
    const days = tradingDaysEndingAt(target, 20);
    const highCloses = days.map((date, index) => ({
      date,
      close: index === days.length - 1 ? 120 : 100,
    }));
    const flatCloses = days.map((date) => ({ date, close: 100 }));

    const breadth = computeBreadth({
      seriesBySymbol: new Map([
        ["NVDA", barSeries("NVDA", highCloses)],
        ["BRK.B", barSeries("BRK.B", flatCloses)],
        ["BF.B", barSeries("BF.B", flatCloses)],
      ]),
      targetMarketSessionDate: target,
    });

    expect(breadth.metrics.new20DayClosingHigh.numerator).toBe(1);
    expect(breadth.metrics.new20DayClosingHigh.denominator).toBe(3);
    expect(breadth.coverage.closingHighLow20Coverage).toBe(1);
  });

  it("flags new closing low when target close is below prior 19 closes", () => {
    const target = "2026-08-06";
    const days = tradingDaysEndingAt(target, 20);
    const lowCloses = days.map((date, index) => ({
      date,
      close: index === days.length - 1 ? 80 : 100,
    }));
    const flatCloses = days.map((date) => ({ date, close: 100 }));

    const breadth = computeBreadth({
      seriesBySymbol: new Map([
        ["NVDA", barSeries("NVDA", lowCloses)],
        ["BRK.B", barSeries("BRK.B", flatCloses)],
        ["BF.B", barSeries("BF.B", flatCloses)],
      ]),
      targetMarketSessionDate: target,
    });

    expect(breadth.metrics.new20DayClosingLow.numerator).toBe(1);
    expect(breadth.metrics.new20DayClosingLow.denominator).toBe(3);
  });
});

describe("coverage gates", () => {
  it("marks MA metrics unavailable (not partial) when coverage is below threshold", () => {
    const breadth = computeBreadth({
      seriesBySymbol: new Map([
        [
          "NVDA",
          barSeries("NVDA", [
            { date: "2026-08-05", close: 100 },
            { date: "2026-08-06", close: 101 },
          ]),
        ],
        [
          "BRK.B",
          barSeries("BRK.B", [
            { date: "2026-08-05", close: 50 },
            { date: "2026-08-06", close: 49 },
          ]),
        ],
        [
          "BF.B",
          barSeries("BF.B", [
            { date: "2026-08-05", close: 30 },
            { date: "2026-08-06", close: 30 },
          ]),
        ],
      ]),
    });

    expect(breadth.metrics.percentAboveMA20.status).toBe("unavailable");
    expect(breadth.metrics.percentAboveMA20.status).not.toBe("partial");
    expect(breadth.metrics.percentAboveMA50.status).toBe("unavailable");
    expect(breadth.status).toBe("unavailable");
    expect(breadth.missingReason).toMatch(/MA20|MA50|closing/i);
  });

  it("marks snapshot unavailable when MA coverage is zero", () => {
    const breadth = computeBreadth({
      seriesBySymbol: new Map([
        [
          "NVDA",
          barSeries("NVDA", [{ date: "2026-08-06", close: 100 }]),
        ],
        [
          "BRK.B",
          barSeries("BRK.B", [{ date: "2026-08-06", close: 50 }]),
        ],
        [
          "BF.B",
          barSeries("BF.B", [{ date: "2026-08-06", close: 30 }]),
        ],
      ]),
    });

    expect(breadth.coverage.ma20Coverage).toBe(0);
    expect(breadth.coverage.ma50Coverage).toBe(0);
    expect(breadth.status).toBe("unavailable");
    expect(breadth.missingReason).not.toBeNull();
  });
});

describe("schema version isolation", () => {
  it("preserves legacy 0.1.0 field names and version on read", () => {
    const current = samplePublishableBreadthSnapshot();
    const parsed = parseStoredBreadthSnapshotJson(
      legacyStoredSnapshotJson(current),
    );
    expect(parsed.schemaVersion).toBe(BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION);
    expect(isLegacyBreadthInternalsSnapshot(parsed)).toBe(true);
    if (isLegacyBreadthInternalsSnapshot(parsed)) {
      expect(parsed.metrics.new20DayHigh).toBeDefined();
      expect(parsed.coverage.highLow20Coverage).toBeDefined();
    }
    expect(parsed.schemaVersion).not.toBe(BREADTH_INTERNALS_SCHEMA_VERSION);
  });
});

describe("breadth snapshot history helpers", () => {
  it("clamps recent snapshot limits to 5–10", () => {
    expect(clampRecentBreadthSnapshotLimit()).toBe(10);
    expect(clampRecentBreadthSnapshotLimit(3)).toBe(5);
    expect(clampRecentBreadthSnapshotLimit(7)).toBe(7);
    expect(clampRecentBreadthSnapshotLimit(20)).toBe(10);
  });

  it("dedupes by session and keeps latest asOf", () => {
    const deduped = dedupeBreadthSnapshotsBySession([
      {
        marketSessionDate: "2026-08-05",
        asOf: "2026-08-05T15:00:00.000Z",
      } as never,
      {
        marketSessionDate: "2026-08-06",
        asOf: "2026-08-06T15:00:00.000Z",
      } as never,
      {
        marketSessionDate: "2026-08-06",
        asOf: "2026-08-06T16:00:00.000Z",
      } as never,
    ]);

    expect(deduped.map((row) => row.marketSessionDate)).toEqual([
      "2026-08-06",
      "2026-08-05",
    ]);
    expect(deduped[0]?.asOf).toBe("2026-08-06T16:00:00.000Z");
  });
});
