import { ALL_SYMBOLS, type MacroSymbol, type RegimeSignatureConfig } from "@/contracts";
import {
  assembleSnapshot,
  type MacroSnapshot,
  type SymbolSeries,
} from "@/ingest";
import { DEFAULT_WINDOW_LENGTH } from "@/macro";

export interface DayRecord {
  readonly marketSessionDate: string;
  readonly primaryRegime: string;
  readonly polarity: string | null;
  readonly riskDirection: string | null;
  readonly label: string;
  readonly confidenceScore: number;
  readonly calibrated: boolean;
  readonly isCompleteSession: boolean;
  readonly sessionAlignment: string;
  readonly patternMatch: number;
  readonly distinctiveness: number;
  readonly coherence: number;
  readonly effectiveBreadth: number;
  readonly strength: number;
  readonly coveragePenalty: number;
  readonly effectiveConfirmations: number;
  readonly blocksScored: number;
  readonly scoreTop: number;
  readonly scoreSecond: number | null;
  readonly winnerMargin: number | null;
  readonly hardCapRules: string[];
  readonly zeroedBy: string | null;
  readonly runnerUpRegime: string | null;
  /** How many symbols had a usable z-score that day. */
  readonly observedZCount: number;
}

function componentValue(snapshot: MacroSnapshot, name: string): number {
  return (
    snapshot.classification.confidence.components.find((c) => c.name === name)
      ?.value ?? 0
  );
}

export function truncateSeries(
  series: SymbolSeries,
  asOf: string,
): SymbolSeries {
  return {
    ...series,
    bars: series.bars.filter((b) => b.sessionDate <= asOf),
  };
}

/**
 * Candidate sessions are dates present on both core rates, after the feature
 * window can fill. Using rates as the spine keeps the cut honest when VIX lags.
 */
export function candidateSessions(
  seriesBySymbol: ReadonlyMap<MacroSymbol, SymbolSeries>,
  minHistorySessions: number = DEFAULT_WINDOW_LENGTH + 2,
): string[] {
  const us2y = seriesBySymbol.get("US2Y");
  const us10y = seriesBySymbol.get("US10Y");
  if (!us2y || !us10y) {
    throw new Error("US2Y and US10Y are required for replay");
  }
  const dates2 = new Set(us2y.bars.map((b) => b.sessionDate));
  const shared = us10y.bars
    .map((b) => b.sessionDate)
    .filter((d) => dates2.has(d))
    .sort();
  // Skip the warm-up window so most days can form a z-score; earlier days
  // still appear if we lower the floor, but they are mostly insufficient_data.
  return shared.slice(minHistorySessions - 1);
}

export function recordFromSnapshot(snapshot: MacroSnapshot): DayRecord {
  const { classification } = snapshot;
  const scoreTop = classification.confidence.detail.scoreTop;
  const scoreSecond = classification.confidence.detail.scoreSecond;
  return {
    marketSessionDate: snapshot.marketSessionDate,
    primaryRegime: classification.primaryRegime,
    polarity: classification.polarity,
    riskDirection: classification.riskDirection,
    label: classification.label,
    confidenceScore: classification.confidence.score,
    calibrated: classification.confidence.calibrated,
    isCompleteSession: snapshot.isCompleteSession,
    sessionAlignment: snapshot.sessionAlignment,
    patternMatch: componentValue(snapshot, "patternMatch"),
    distinctiveness: componentValue(snapshot, "distinctiveness"),
    coherence: componentValue(snapshot, "coherence"),
    effectiveBreadth: componentValue(snapshot, "effectiveBreadth"),
    strength: componentValue(snapshot, "strength"),
    coveragePenalty: classification.confidence.coveragePenalty,
    effectiveConfirmations:
      classification.confidence.detail.effectiveConfirmations,
    blocksScored: classification.confidence.detail.blocksScored,
    scoreTop,
    scoreSecond,
    winnerMargin:
      scoreSecond === null
        ? null
        : Math.abs(scoreTop) - Math.abs(scoreSecond),
    hardCapRules: classification.confidence.hardCapsApplied.map((c) => c.rule),
    zeroedBy: classification.confidence.zeroedBy,
    runnerUpRegime: classification.confidence.detail.runnerUpRegime,
    observedZCount: snapshot.features.filter((f) => f.zScore !== null).length,
  };
}

/**
 * Point-in-time replay: for each session t, only bars with sessionDate ≤ t
 * are visible. assembleSnapshot / buildMacroFeature already keep the sigma
 * window ending at t-1, so the observation at t never scales itself.
 */
export function replayHistory(
  seriesList: readonly SymbolSeries[],
  config: RegimeSignatureConfig,
  options: { readonly minHistorySessions?: number } = {},
): DayRecord[] {
  const seriesBySymbol = new Map(
    seriesList.map((s) => [s.symbol, s] as const),
  );
  for (const symbol of ALL_SYMBOLS) {
    if (!seriesBySymbol.has(symbol)) {
      throw new Error(`missing series for ${symbol}`);
    }
  }

  const sessions = candidateSessions(
    seriesBySymbol,
    options.minHistorySessions ?? DEFAULT_WINDOW_LENGTH + 2,
  );
  const records: DayRecord[] = [];

  for (const t of sessions) {
    const truncated = ALL_SYMBOLS.map((symbol) =>
      truncateSeries(seriesBySymbol.get(symbol)!, t),
    );
    const snapshot = assembleSnapshot(truncated, config, {
      marketSessionDate: t,
      generatedAt: `${t}T20:00:00.000Z`,
    });
    records.push(recordFromSnapshot(snapshot));
  }

  return records;
}
