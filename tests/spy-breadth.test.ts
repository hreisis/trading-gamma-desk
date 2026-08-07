import { describe, expect, it } from "vitest";
import type { DailyBar } from "@/desk/breadth/bars/types";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";
import {
  evaluateUniverseFreshness,
  tradingSessionLag,
} from "@/desk/breadth/universe/session-lag";
import { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { buildMarketInputSnapshot, loadBoundedGammaDeskView } from "@/desk";
import { statusCountTotal } from "@/contracts";

function sampleRows(): string[][] {
  return [
    ["Fund Name:", "State Street® SPDR® S&P 500® ETF Trust"],
    ["Ticker Symbol:", "SPY"],
    ["Holdings:", "As of 05-Aug-2026"],
    ["Name", "Ticker", "Identifier", "Weight", "Sector", "Shares Held", "Local Currency"],
    ["NVIDIA CORP", "NVDA", "67066G104", "7.99", "-", "100", "USD"],
    ["BERKSHIRE HATHAWAY INC CL B", "BRK.B", "084670702", "1.44", "-", "10", "USD"],
    ["BROWN FORMAN CORP CL B", "BF.B", "115637209", "0.01", "-", "1", "USD"],
    ["CASH", "-", "-", "0.1", "-", "0", "USD"],
    ["PRIVATE PLACEMENT", "2602335D", "2602335D", "0.01", "-", "1", "USD"],
    ["DUPLICATE NVDA", "NVDA", "67066G104", "0.01", "-", "1", "USD"],
  ];
}

function barSeries(
  symbol: string,
  closes: Array<{ date: string; close: number; high?: number; low?: number }>,
) {
  return {
    symbol,
    updatedAt: "2026-08-06T12:00:00.000Z",
    bars: closes.map((row) => ({
      sessionDate: row.date,
      open: row.close,
      high: row.high ?? row.close + 1,
      low: row.low ?? row.close - 1,
      close: row.close,
      volume: 1_000,
    })),
  };
}

function baseUniverse(): EtfUniverseArtifact {
  return parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt: "2026-08-06T12:00:00.000Z",
  });
}

describe("parseSpyHoldingsMatrix", () => {
  it("classifies cash, non-equity, duplicates, and keeps BRK.B / BF.B", () => {
    const artifact = baseUniverse();
    expect(artifact.rowCounts).toMatchObject({
      sheetDataRowCount: 6,
      holdingCandidateCount: 6,
      constituentCount: 3,
      excludedHoldingCount: 3,
      ignoredMetadataRowCount: 0,
      duplicateCount: 1,
    });
    expect(artifact.excludedRows.map((row) => row.exclusionReason).sort()).toEqual(
      ["cash_row", "duplicate_ticker", "non_equity_ticker"].sort(),
    );
    expect(artifact.constituents.map((row) => row.symbol).sort()).toEqual(
      ["BF.B", "BRK.B", "NVDA"].sort(),
    );
    expect(artifact.rowCounts.includedWeightSum).toBeCloseTo(9.44, 2);
  });

  it("ignores disclaimer metadata rows without adding them to excludedRows", () => {
    const artifact = parseSpyHoldingsMatrix({
      rows: [
        ...sampleRows().slice(0, 4),
        ["NVIDIA CORP", "NVDA", "67066G104", "7.99", "-", "100", "USD"],
        [
          "Past performance is not a reliable indicator of future performance.",
          "",
          "",
          "",
          "",
          "",
          "",
        ],
        ["CASH", "-", "-", "0.1", "-", "0", "USD"],
      ],
      fetchedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(artifact.rowCounts).toMatchObject({
      sheetDataRowCount: 3,
      holdingCandidateCount: 2,
      constituentCount: 1,
      excludedHoldingCount: 1,
      ignoredMetadataRowCount: 1,
    });
    expect(artifact.excludedRows).toHaveLength(1);
    expect(artifact.excludedRows[0]?.exclusionReason).toBe("cash_row");
  });
});

describe("session-aware universe freshness", () => {
  it("allows previous trading session and flags multi-session stale", () => {
    expect(tradingSessionLag("2026-08-05", "2026-08-06")).toBe(1);
    expect(
      evaluateUniverseFreshness({
        universeAsOf: "2026-08-05",
        targetMarketSessionDate: "2026-08-06",
      }).stale,
    ).toBe(false);
    expect(
      evaluateUniverseFreshness({
        universeAsOf: "2026-08-01",
        targetMarketSessionDate: "2026-08-06",
      }).stale,
    ).toBe(true);
    expect(
      evaluateUniverseFreshness({
        universeAsOf: "2026-07-02",
        targetMarketSessionDate: "2026-07-06",
      }).sessionLag,
    ).toBe(1);
  });
});

describe("computeSpyBreadthInternals", () => {
  it("computes advance/decline and MA metrics with unequal denominators", () => {
    const universe = baseUniverse();
    const seriesBySymbol = new Map([
      [
        "NVDA",
        barSeries("NVDA", [
          { date: "2026-07-01", close: 100 },
          { date: "2026-08-05", close: 105 },
          { date: "2026-08-06", close: 110 },
        ]),
      ],
      [
        "BRK.B",
        barSeries("BRK.B", [
          { date: "2026-08-05", close: 50 },
          { date: "2026-08-06", close: 48 },
        ]),
      ],
      [
        "BF.B",
        barSeries("BF.B", [
          { date: "2026-08-05", close: 30 },
          { date: "2026-08-06", close: 30 },
        ]),
      ],
    ]);

    const breadth = computeSpyBreadthInternals({
      universe: { ...universe, sessionLag: 0, stale: false, status: "available" },
      targetMarketSessionDate: "2026-08-06",
      asOf: "2026-08-06T16:00:00.000Z",
      seriesBySymbol,
      barsProvenance: {
        provider: "alpaca",
        priceFeed: "iex",
        isConsolidated: false,
        adjustment: "split",
        requestedSymbols: 3,
        returnedSymbols: 3,
        coverage: 1,
        pages: 1,
        fetchedAt: "2026-08-06T16:00:00.000Z",
        latestSessionDate: "2026-08-06",
        failedSymbols: [],
      },
    });

    expect(breadth.advance).toBe(1);
    expect(breadth.decline).toBe(1);
    expect(breadth.unchanged).toBe(1);
    expect(breadth.metrics.advanceDecline).toMatchObject({
      advance: 1,
      decline: 1,
      unchanged: 1,
      eligibleCount: 3,
      denominator: 3,
    });
    expect(
      breadth.metrics.advanceDecline.advance +
        breadth.metrics.advanceDecline.decline +
        breadth.metrics.advanceDecline.unchanged,
    ).toBe(breadth.metrics.advanceDecline.eligibleCount);
    expect("numerator" in breadth.metrics.advanceDecline).toBe(false);
    expect(breadth.metrics.percentAboveMA20.eligibleCount).toBeLessThan(3);
    expect(breadth.bars.isConsolidated).toBe(false);
    expect(breadth.bars.priceFeed).toBe("iex");
  });
});

describe("MarketInputSnapshot breadth wiring", () => {
  it("marks breadth unavailable when not loaded and keeps 14 keys", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-08-06",
      generatedAt: "2026-08-06T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });
    expect(snapshot.inputs).toHaveLength(14);
    expect(statusCountTotal(snapshot.summary)).toBe(14);
    const breadth = snapshot.inputs.find((row) => row.key === "breadth_internals");
    expect(breadth?.status).toBe("unavailable");
    expect(breadth?.isProxy).toBe(false);
  });
});
