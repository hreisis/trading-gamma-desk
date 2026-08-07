import type {
  BreadthAdvanceDeclineMetric,
  BreadthInternalsSnapshot,
  BreadthMetricResult,
} from "@/contracts/breadth-internals";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { defaultSessionCalendar } from "@/macro/calendar";
import type { AlpacaPanelProvenance } from "../bars/alpaca-panel";
import type { DailyBar, SymbolBarSeries } from "../bars/types";
import { SPY_BREADTH_CONFIG } from "../config";

export interface BreadthComputeInput {
  readonly universe: EtfUniverseArtifact;
  readonly targetMarketSessionDate: string;
  readonly asOf: string;
  readonly seriesBySymbol: ReadonlyMap<string, SymbolBarSeries>;
  readonly barsProvenance: AlpacaPanelProvenance;
}

function advanceDeclineMetric(input: {
  advance: number;
  decline: number;
  unchanged: number;
  eligibleCount: number;
  includedCount: number;
  threshold: number;
  hardFloor?: number;
  missingReason?: string | null;
}): BreadthAdvanceDeclineMetric {
  const coverage =
    input.includedCount === 0 ? 0 : input.eligibleCount / input.includedCount;
  let status: BreadthAdvanceDeclineMetric["status"] = "unavailable";
  if (coverage >= input.threshold) status = "available";
  else if (coverage >= (input.hardFloor ?? 0)) status = "partial";
  return {
    advance: input.advance,
    decline: input.decline,
    unchanged: input.unchanged,
    eligibleCount: input.eligibleCount,
    denominator: input.eligibleCount,
    coverage,
    status,
    missingReason:
      status === "available"
        ? null
        : input.missingReason ??
          `Coverage ${(coverage * 100).toFixed(1)}% below threshold ${(input.threshold * 100).toFixed(0)}%.`,
  };
}

function metricResult(input: {
  numerator: number;
  denominator: number;
  eligibleCount: number;
  includedCount: number;
  threshold: number;
  hardFloor?: number;
  missingReason?: string | null;
}): BreadthMetricResult {
  const coverage =
    input.includedCount === 0 ? 0 : input.eligibleCount / input.includedCount;
  let status: BreadthMetricResult["status"] = "unavailable";
  if (coverage >= input.threshold) status = "available";
  else if (coverage >= (input.hardFloor ?? 0)) status = "partial";
  return {
    numerator: input.numerator,
    denominator: input.denominator,
    eligibleCount: input.eligibleCount,
    coverage,
    status,
    missingReason:
      status === "available"
        ? null
        : input.missingReason ??
          `Coverage ${(coverage * 100).toFixed(1)}% below threshold ${(input.threshold * 100).toFixed(0)}%.`,
  };
}

function barsUpToTarget(
  bars: readonly DailyBar[],
  targetSession: string,
): DailyBar[] {
  return bars.filter((bar) => bar.sessionDate <= targetSession);
}

function priorClosesExcludingTarget(
  bars: readonly DailyBar[],
  targetSession: string,
  count: number,
): number[] {
  const prior = bars
    .filter((bar) => bar.sessionDate < targetSession)
    .map((bar) => bar.close);
  return prior.slice(-count);
}

export function computeSpyBreadthInternals(
  input: BreadthComputeInput,
): BreadthInternalsSnapshot {
  const includedCount = input.universe.constituents.length;
  const calendar = defaultSessionCalendar;
  const previousSession = calendar.previousSession(input.targetMarketSessionDate);

  let advance = 0;
  let decline = 0;
  let unchanged = 0;
  let pricePairEligible = 0;
  let ma20Eligible = 0;
  let ma50Eligible = 0;
  let hl20Eligible = 0;
  let aboveMa20 = 0;
  let aboveMa50 = 0;
  let new20High = 0;
  let new20Low = 0;

  for (const constituent of input.universe.constituents) {
    const series = input.seriesBySymbol.get(constituent.symbol);
    const bars = barsUpToTarget(series?.bars ?? [], input.targetMarketSessionDate);
    const targetBar = bars.find(
      (bar) => bar.sessionDate === input.targetMarketSessionDate,
    );
    if (!targetBar || !previousSession) continue;
    const prevBar = bars.find((bar) => bar.sessionDate === previousSession);
    if (!prevBar) continue;
    pricePairEligible += 1;
    const delta = targetBar.close - prevBar.close;
    if (delta > 0) advance += 1;
    else if (delta < 0) decline += 1;
    else unchanged += 1;

    const prior20 = priorClosesExcludingTarget(
      bars,
      input.targetMarketSessionDate,
      20,
    );
    if (prior20.length >= 20) {
      ma20Eligible += 1;
      hl20Eligible += 1;
      const ma20 = prior20.reduce((sum, value) => sum + value, 0) / prior20.length;
      if (targetBar.close > ma20) aboveMa20 += 1;
      const priorHigh = Math.max(...prior20);
      const priorLow = Math.min(...prior20);
      if (targetBar.close > priorHigh) new20High += 1;
      if (targetBar.close < priorLow) new20Low += 1;
    }

    const prior50 = priorClosesExcludingTarget(
      bars,
      input.targetMarketSessionDate,
      50,
    );
    if (prior50.length >= 50) {
      ma50Eligible += 1;
      const ma50 = prior50.reduce((sum, value) => sum + value, 0) / prior50.length;
      if (targetBar.close > ma50) aboveMa50 += 1;
    }
  }

  const pricePairCoverage =
    includedCount === 0 ? 0 : pricePairEligible / includedCount;
  const ma20Coverage = includedCount === 0 ? 0 : ma20Eligible / includedCount;
  const ma50Coverage = includedCount === 0 ? 0 : ma50Eligible / includedCount;
  const highLow20Coverage =
    includedCount === 0 ? 0 : hl20Eligible / includedCount;

  const advanceDecline = advanceDeclineMetric({
    advance,
    decline,
    unchanged,
    eligibleCount: pricePairEligible,
    includedCount,
    threshold: SPY_BREADTH_CONFIG.thresholdPricePair,
    hardFloor: SPY_BREADTH_CONFIG.hardFloorPricePair,
    missingReason: "Insufficient price-pair coverage for advance/decline.",
  });

  const percentAboveMA20 = metricResult({
    numerator: aboveMa20,
    denominator: ma20Eligible,
    eligibleCount: ma20Eligible,
    includedCount,
    threshold: SPY_BREADTH_CONFIG.thresholdMa20,
    missingReason: "Insufficient MA20-eligible symbols.",
  });

  const percentAboveMA50 = metricResult({
    numerator: aboveMa50,
    denominator: ma50Eligible,
    eligibleCount: ma50Eligible,
    includedCount,
    threshold: SPY_BREADTH_CONFIG.thresholdMa50,
    missingReason: "Insufficient MA50-eligible symbols.",
  });

  const new20DayHigh = metricResult({
    numerator: new20High,
    denominator: hl20Eligible,
    eligibleCount: hl20Eligible,
    includedCount,
    threshold: SPY_BREADTH_CONFIG.thresholdHighLow20,
    missingReason: "Insufficient 20D high/low eligible symbols.",
  });

  const new20DayLow = metricResult({
    numerator: new20Low,
    denominator: hl20Eligible,
    eligibleCount: hl20Eligible,
    includedCount,
    threshold: SPY_BREADTH_CONFIG.thresholdHighLow20,
    missingReason: "Insufficient 20D high/low eligible symbols.",
  });

  const universeStale = input.universe.stale;
  const barsSessionMismatch =
    input.barsProvenance.latestSessionDate !== null &&
    input.barsProvenance.latestSessionDate !== input.targetMarketSessionDate;

  let status: BreadthInternalsSnapshot["status"] = "available";
  let missingReason: string | null = null;
  if (universeStale || input.universe.status === "unavailable") {
    status = "unavailable";
    missingReason = input.universe.sessionLag !== null
      ? `SPY universe stale (sessionLag=${input.universe.sessionLag}).`
      : "SPY universe unavailable.";
  } else if (advanceDecline.status === "unavailable") {
    status = "unavailable";
    missingReason = advanceDecline.missingReason;
  } else if (
    advanceDecline.status === "partial" ||
    percentAboveMA20.status === "partial" ||
    percentAboveMA50.status === "partial" ||
    new20DayHigh.status === "partial" ||
    new20DayLow.status === "partial" ||
    barsSessionMismatch
  ) {
    status = "partial";
    missingReason = barsSessionMismatch
      ? `Bar panel latest session ${input.barsProvenance.latestSessionDate} does not match target ${input.targetMarketSessionDate}.`
      : "One or more breadth metrics below production coverage threshold.";
  }

  return BreadthInternalsSnapshotSchema.parse({
    kind: "BreadthInternals",
    schemaVersion: "0.1.0",
    marketSessionDate: input.targetMarketSessionDate,
    asOf: input.asOf,
    advance,
    decline,
    unchanged,
    metrics: {
      advanceDecline,
      percentAboveMA20,
      percentAboveMA50,
      new20DayHigh,
      new20DayLow,
    },
    coverage: {
      pricePairCoverage,
      ma20Coverage,
      ma50Coverage,
      highLow20Coverage,
    },
    universe: {
      universeId: "spy_etf_holdings",
      fundSymbol: "SPY",
      provenanceType: "official_etf_holdings",
      provider: input.universe.provider,
      sourceUrl: input.universe.sourceUrl,
      asOf: input.universe.asOf,
      fetchedAt: input.universe.fetchedAt,
      sessionLag: input.universe.sessionLag,
      stale: input.universe.stale,
    },
    bars: input.barsProvenance,
    status,
    stale: universeStale || barsSessionMismatch,
    missingReason,
  });
}
