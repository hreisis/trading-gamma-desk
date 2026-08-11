import type {
  BreadthAdvanceDeclineMetric,
  BreadthInternalsSnapshot,
  BreadthMetricResult,
} from "@/contracts/breadth-internals";
import { tradingDaysEndingAt } from "./breadth-fixtures";

function metricResult(
  numerator: number,
  denominator: number,
  status: BreadthMetricResult["status"] = "available",
): BreadthMetricResult {
  return {
    numerator,
    denominator,
    eligibleCount: denominator,
    coverage: 1,
    status,
    missingReason: status === "available" ? null : "metric unavailable for test",
  };
}

function advanceDeclineMetric(
  advance: number,
  decline: number,
  unchanged = 0,
  status: BreadthAdvanceDeclineMetric["status"] = "available",
): BreadthAdvanceDeclineMetric {
  const eligibleCount = advance + decline + unchanged;
  return {
    advance,
    decline,
    unchanged,
    eligibleCount,
    denominator: eligibleCount,
    coverage: 1,
    status,
    missingReason: status === "available" ? null : "advanceDecline unavailable for test",
  };
}

const BASE_UNIVERSE = {
  universeId: "spy_etf_holdings" as const,
  fundSymbol: "SPY" as const,
  provenanceType: "official_etf_holdings" as const,
  provider: "ssga",
  sourceUrl: "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx",
  asOf: "2026-08-01",
  fetchedAt: "2026-08-01T12:00:00.000Z",
  sessionLag: 0,
  stale: false,
};

const BASE_BARS = {
  provider: "alpaca" as const,
  priceFeed: "iex" as const,
  isConsolidated: false,
  adjustment: "split" as const,
  requestedSymbols: 503,
  returnedSymbols: 503,
  coverage: 1,
  pages: 1,
  fetchedAt: "2026-08-06T22:00:00.000Z",
  latestSessionDate: "2026-08-06",
  failedSymbols: [],
};

export function buildOverlayBreadthSnapshot(
  marketSessionDate: string,
): BreadthInternalsSnapshot {
  const denominator = 500;
  return {
    kind: "BreadthInternals",
    schemaVersion: "0.2.0",
    marketSessionDate,
    asOf: `${marketSessionDate}T16:00:00.000Z`,
    advance: 280,
    decline: 200,
    unchanged: 20,
    metrics: {
      advanceDecline: advanceDeclineMetric(280, 200, 20),
      percentAboveMA20: metricResult(325, denominator),
      percentAboveMA50: metricResult(300, denominator),
      new20DayClosingHigh: metricResult(80, denominator),
      new20DayClosingLow: metricResult(40, denominator),
    },
    coverage: {
      pricePairCoverage: 0.95,
      ma20Coverage: 0.9,
      ma50Coverage: 0.88,
      closingHighLow20Coverage: 0.9,
    },
    universe: { ...BASE_UNIVERSE, asOf: marketSessionDate },
    bars: {
      ...BASE_BARS,
      fetchedAt: `${marketSessionDate}T22:00:00.000Z`,
      latestSessionDate: marketSessionDate,
    },
    status: "available",
    stale: false,
    missingReason: null,
  };
}

export function overlayEligibleSeries(
  count: number,
  endDate = "2026-08-10",
): BreadthInternalsSnapshot[] {
  const days = tradingDaysEndingAt(endDate, count);
  return days.map((date) => buildOverlayBreadthSnapshot(date));
}

export function partialOverlaySnapshot(
  marketSessionDate = "2026-08-10",
): BreadthInternalsSnapshot {
  const snapshot = buildOverlayBreadthSnapshot(marketSessionDate);
  return {
    ...snapshot,
    status: "partial",
    missingReason: "Advance/decline coverage below production threshold.",
    metrics: {
      ...snapshot.metrics,
      advanceDecline: {
        ...snapshot.metrics.advanceDecline,
        status: "partial",
        missingReason: "Partial price-pair coverage.",
      },
    },
  };
}

export function staleOverlaySnapshot(
  marketSessionDate = "2026-08-10",
): BreadthInternalsSnapshot {
  const snapshot = buildOverlayBreadthSnapshot(marketSessionDate);
  return {
    ...snapshot,
    stale: true,
    missingReason: "Snapshot stale for overlay test.",
    universe: { ...snapshot.universe, stale: true, sessionLag: 2 },
  };
}

export function unavailableMetricsOverlaySnapshot(
  marketSessionDate = "2026-08-10",
): BreadthInternalsSnapshot {
  const snapshot = buildOverlayBreadthSnapshot(marketSessionDate);
  return {
    ...snapshot,
    metrics: {
      ...snapshot.metrics,
      percentAboveMA20: metricResult(0, 0, "unavailable"),
    },
  };
}
