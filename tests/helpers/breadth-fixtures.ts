import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import { SPY_BREADTH_CONFIG } from "@/desk/breadth/config";
import { parseSpyHoldingsMatrix } from "@/desk/breadth/holdings/parse-spy-holdings";

export function sampleRows(): string[][] {
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

export function tradingDaysEndingAt(endDate: string, count: number): string[] {
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

export function barSeries(
  symbol: string,
  closes: Array<{ date: string; close: number }>,
  updatedAt = "2026-08-06T22:00:00.000Z",
) {
  return {
    symbol,
    updatedAt,
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

export function baseUniverse(fetchedAt = "2026-08-06T22:00:00.000Z"): EtfUniverseArtifact {
  return parseSpyHoldingsMatrix({
    rows: sampleRows(),
    fetchedAt,
  });
}

export function freshUniverse(fetchedAt = "2026-08-06T22:00:00.000Z"): EtfUniverseArtifact {
  return {
    ...baseUniverse(fetchedAt),
    sessionLag: 0,
    stale: false,
    status: "available",
  };
}

/** Bar panel with enough history for MA20 / MA50 / closing-high/low gates. */
export function publishablePanelForTargetSession(targetSession: string) {
  const historyDays = Math.max(
    SPY_BREADTH_CONFIG.minSessionsMa50,
    SPY_BREADTH_CONFIG.minSessionsMa20,
    SPY_BREADTH_CONFIG.minSessionsClosingHighLow20,
  );
  const historyDates = tradingDaysEndingAt(targetSession, historyDays);
  const seriesBySymbol = new Map([
    [
      "NVDA",
      barSeries(
        "NVDA",
        historyDates.map((date, index) => ({
          date,
          close: 100 + index,
        })),
      ),
    ],
    [
      "BRK.B",
      barSeries(
        "BRK.B",
        historyDates.map((date, index) => ({
          date,
          close: 50 - index,
        })),
      ),
    ],
    [
      "BF.B",
      barSeries(
        "BF.B",
        historyDates.map((date) => ({ date, close: 30 })),
      ),
    ],
  ]);

  return {
    seriesBySymbol,
    provenance: {
      provider: "alpaca" as const,
      priceFeed: "iex" as const,
      isConsolidated: false,
      adjustment: "split" as const,
      requestedSymbols: 3,
      returnedSymbols: 3,
      coverage: 1,
      pages: 1,
      fetchedAt: `${targetSession}T22:00:00.000Z`,
      latestSessionDate: targetSession,
      failedSymbols: [],
    },
  };
}

export function computePublishableSnapshotForSession(
  marketSessionDate: string,
  asOf = `${marketSessionDate}T16:00:00.000Z`,
): BreadthInternalsSnapshot {
  const panel = publishablePanelForTargetSession(marketSessionDate);
  return computeSpyBreadthInternals({
    universe: freshUniverse(asOf),
    targetMarketSessionDate: marketSessionDate,
    asOf,
    seriesBySymbol: panel.seriesBySymbol,
    barsProvenance: panel.provenance,
  });
}

export function samplePublishableBreadthSnapshot(
  marketSessionDate = "2026-08-06",
  asOf = `${marketSessionDate}T16:00:00.000Z`,
): BreadthInternalsSnapshot {
  const panel = publishablePanelForTargetSession(marketSessionDate);
  return computeSpyBreadthInternals({
    universe: freshUniverse(asOf),
    targetMarketSessionDate: marketSessionDate,
    asOf,
    seriesBySymbol: panel.seriesBySymbol,
    barsProvenance: panel.provenance,
  });
}

/** Serialize a 0.1.0 artifact with legacy field names for store isolation tests. */
export function legacyStoredSnapshotJson(snapshot: BreadthInternalsSnapshot): string {
  return JSON.stringify({
    ...snapshot,
    schemaVersion: "0.1.0",
    metrics: {
      advanceDecline: snapshot.metrics.advanceDecline,
      percentAboveMA20: snapshot.metrics.percentAboveMA20,
      percentAboveMA50: snapshot.metrics.percentAboveMA50,
      new20DayHigh: snapshot.metrics.new20DayClosingHigh,
      new20DayLow: snapshot.metrics.new20DayClosingLow,
    },
    coverage: {
      pricePairCoverage: snapshot.coverage.pricePairCoverage,
      ma20Coverage: snapshot.coverage.ma20Coverage,
      ma50Coverage: snapshot.coverage.ma50Coverage,
      highLow20Coverage: snapshot.coverage.closingHighLow20Coverage,
    },
  });
}
