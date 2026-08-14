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
import type { BreadthFundConfig } from "../config";
import { SPY_BREADTH_CONFIG, QQQ_BREADTH_CONFIG } from "../config";

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
  allowPartial?: boolean;
  missingReason?: string | null;
}): BreadthMetricResult {
  const coverage =
    input.includedCount === 0 ? 0 : input.eligibleCount / input.includedCount;
  const partialFloor =
    input.allowPartial === false
      ? input.threshold
      : (input.hardFloor ?? 0);
  let status: BreadthMetricResult["status"] = "unavailable";
  if (coverage >= input.threshold) status = "available";
  else if (coverage >= partialFloor) status = "partial";
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

/** Last N session closes ending at `targetSession`, including that session's close. */
export function closesEndingAtTarget(
  bars: readonly DailyBar[],
  targetSession: string,
  count: number,
): number[] {
  const filtered = barsUpToTarget(bars, targetSession);
  if (filtered.length < count) return [];
  if (filtered.at(-1)?.sessionDate !== targetSession) return [];
  return filtered.slice(-count).map((bar) => bar.close);
}

function firstUnavailableReason(
  metrics: readonly BreadthMetricResult[],
): string | null {
  for (const metric of metrics) {
    if (metric.status === "unavailable" && metric.missingReason) {
      return metric.missingReason;
    }
  }
  return null;
}

export function computeEtfBreadthInternals(
  input: BreadthComputeInput,
  config: BreadthFundConfig,
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
  let closingHl20Eligible = 0;
  let aboveMa20 = 0;
  let aboveMa50 = 0;
  let new20ClosingHigh = 0;
  let new20ClosingLow = 0;

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

    const closes20 = closesEndingAtTarget(
      bars,
      input.targetMarketSessionDate,
      config.minSessionsMa20,
    );
    if (closes20.length >= config.minSessionsMa20) {
      ma20Eligible += 1;
      closingHl20Eligible += 1;
      const ma20 =
        closes20.reduce((sum, value) => sum + value, 0) / closes20.length;
      if (targetBar.close > ma20) aboveMa20 += 1;
      const priorCloses = closes20.slice(0, -1);
      if (priorCloses.length > 0) {
        const priorHigh = Math.max(...priorCloses);
        const priorLow = Math.min(...priorCloses);
        if (targetBar.close > priorHigh) new20ClosingHigh += 1;
        if (targetBar.close < priorLow) new20ClosingLow += 1;
      }
    }

    const closes50 = closesEndingAtTarget(
      bars,
      input.targetMarketSessionDate,
      config.minSessionsMa50,
    );
    if (closes50.length >= config.minSessionsMa50) {
      ma50Eligible += 1;
      const ma50 =
        closes50.reduce((sum, value) => sum + value, 0) / closes50.length;
      if (targetBar.close > ma50) aboveMa50 += 1;
    }
  }

  const pricePairCoverage =
    includedCount === 0 ? 0 : pricePairEligible / includedCount;
  const ma20Coverage = includedCount === 0 ? 0 : ma20Eligible / includedCount;
  const ma50Coverage = includedCount === 0 ? 0 : ma50Eligible / includedCount;
  const closingHighLow20Coverage =
    includedCount === 0 ? 0 : closingHl20Eligible / includedCount;

  const advanceDecline = advanceDeclineMetric({
    advance,
    decline,
    unchanged,
    eligibleCount: pricePairEligible,
    includedCount,
    threshold: config.thresholdPricePair,
    hardFloor: config.hardFloorPricePair,
    missingReason: "Insufficient price-pair coverage for advance/decline.",
  });

  const percentAboveMA20 = metricResult({
    numerator: aboveMa20,
    denominator: ma20Eligible,
    eligibleCount: ma20Eligible,
    includedCount,
    threshold: config.thresholdMa20,
    allowPartial: false,
    missingReason: "Insufficient MA20-eligible symbols.",
  });

  const percentAboveMA50 = metricResult({
    numerator: aboveMa50,
    denominator: ma50Eligible,
    eligibleCount: ma50Eligible,
    includedCount,
    threshold: config.thresholdMa50,
    allowPartial: false,
    missingReason: "Insufficient MA50-eligible symbols.",
  });

  const new20DayClosingHigh = metricResult({
    numerator: new20ClosingHigh,
    denominator: closingHl20Eligible,
    eligibleCount: closingHl20Eligible,
    includedCount,
    threshold: config.thresholdHighLow20,
    allowPartial: false,
    missingReason: "Insufficient 20D closing-high eligible symbols.",
  });

  const new20DayClosingLow = metricResult({
    numerator: new20ClosingLow,
    denominator: closingHl20Eligible,
    eligibleCount: closingHl20Eligible,
    includedCount,
    threshold: config.thresholdHighLow20,
    allowPartial: false,
    missingReason: "Insufficient 20D closing-low eligible symbols.",
  });

  const universeStale = input.universe.stale;
  const barsSessionMismatch =
    input.barsProvenance.latestSessionDate !== null &&
    input.barsProvenance.latestSessionDate !== input.targetMarketSessionDate;

  const gatedMetrics = [
    percentAboveMA20,
    percentAboveMA50,
    new20DayClosingHigh,
    new20DayClosingLow,
  ];

  let status: BreadthInternalsSnapshot["status"] = "available";
  let missingReason: string | null = null;
  if (universeStale || input.universe.status === "unavailable") {
    status = "unavailable";
    missingReason = input.universe.sessionLag !== null
      ? `${config.fundSymbol} universe stale (sessionLag=${input.universe.sessionLag}).`
      : `${config.fundSymbol} universe unavailable.`;
  } else if (advanceDecline.status === "unavailable") {
    status = "unavailable";
    missingReason = advanceDecline.missingReason;
  } else if (
    ma20Coverage === 0 ||
    ma50Coverage === 0 ||
    gatedMetrics.some((metric) => metric.status === "unavailable")
  ) {
    status = "unavailable";
    missingReason =
      firstUnavailableReason(gatedMetrics) ??
      "MA or 20D closing-high/low coverage below production minimum.";
  } else if (
    advanceDecline.status === "partial" ||
    barsSessionMismatch
  ) {
    status = "partial";
    missingReason = barsSessionMismatch
      ? `Bar panel latest session ${input.barsProvenance.latestSessionDate} does not match target ${input.targetMarketSessionDate}.`
      : "Advance/decline coverage below production threshold.";
  }

  return BreadthInternalsSnapshotSchema.parse({
    kind: "BreadthInternals",
    schemaVersion: "0.2.0",
    marketSessionDate: input.targetMarketSessionDate,
    asOf: input.asOf,
    advance,
    decline,
    unchanged,
    metrics: {
      advanceDecline,
      percentAboveMA20,
      percentAboveMA50,
      new20DayClosingHigh,
      new20DayClosingLow,
    },
    coverage: {
      pricePairCoverage,
      ma20Coverage,
      ma50Coverage,
      closingHighLow20Coverage,
    },
    universe: {
      universeId: config.universeId,
      fundSymbol: config.fundSymbol,
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

export function computeSpyBreadthInternals(
  input: BreadthComputeInput,
): BreadthInternalsSnapshot {
  return computeEtfBreadthInternals(input, SPY_BREADTH_CONFIG);
}

export function computeQqqBreadthInternals(
  input: BreadthComputeInput,
): BreadthInternalsSnapshot {
  return computeEtfBreadthInternals(input, QQQ_BREADTH_CONFIG);
}
