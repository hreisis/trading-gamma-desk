import {
  ALL_SYMBOLS,
  ASSET_REGISTRY,
  CORE_SYMBOLS,
  CONTRACT_SCHEMA_VERSION,
  type MacroFeature,
  type MacroSymbol,
  type RegimeSignatureConfig,
  type SessionAlignment,
} from "@/contracts";
import {
  DEFAULT_WINDOW_LENGTH,
  buildMacroFeature,
  classifyDriver,
  defaultSessionCalendar,
  type Classification,
  type DailyObservation,
  type ScoreInput,
} from "@/macro";
import type { SymbolSeries } from "./types";

export interface MacroSnapshot {
  readonly schemaVersion: string;
  readonly kind: "MacroComputeSnapshot";
  readonly marketSessionDate: string;
  readonly generatedAt: string;
  readonly sessionAlignment: SessionAlignment;
  readonly isCompleteSession: boolean;
  readonly sourceDateByAsset: Partial<Record<MacroSymbol, string>>;
  readonly staleDaysByAsset: Partial<Record<MacroSymbol, number>>;
  readonly methodology: {
    readonly methodologyVersion: string;
    readonly signatureVersion: string;
    readonly window: number;
    readonly excludesCurrentObservation: true;
    readonly muAssumption: "zero";
    readonly sigmaEstimator: "mad_about_zero_x1.4826";
    readonly cosineRenormalizedOnObservedDims: true;
  };
  readonly features: MacroFeature[];
  readonly classification: Classification;
  /** Paths or inline identities of the bar series used; values stay in data/bars. */
  readonly barSources: Partial<
    Record<MacroSymbol, { source: string; barCount: number }>
  >;
}

function latestOnOrBefore(
  series: SymbolSeries,
  target: string,
): string | null {
  let best: string | null = null;
  for (const bar of series.bars) {
    if (bar.sessionDate <= target) {
      if (best === null || bar.sessionDate > best) best = bar.sessionDate;
    }
  }
  return best;
}

/** Count of expected sessions strictly after `from` up to and including `to`. */
export function sessionDistance(
  from: string,
  to: string,
  isSession: (d: string) => boolean = defaultSessionCalendar.isSession,
): number {
  if (from === to) return 0;
  if (from > to) return sessionDistance(to, from, isSession);
  let count = 0;
  let cursor = from;
  for (let i = 0; i < 400; i += 1) {
    cursor = addOneDay(cursor);
    if (isSession(cursor)) {
      count += 1;
      if (cursor === to) return count;
    }
    if (cursor > to) break;
  }
  return count;
}

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Choose the market session: the latest date on which both core rates printed.
 * ETF/VIX/BTC may lag; that surfaces as staleDays rather than shifting the cut.
 */
export function chooseMarketSession(
  seriesBySymbol: ReadonlyMap<MacroSymbol, SymbolSeries>,
): string {
  const us2y = seriesBySymbol.get("US2Y");
  const us10y = seriesBySymbol.get("US10Y");
  if (!us2y || !us10y) {
    throw new Error("US2Y and US10Y series are required to choose a session");
  }
  const dates2 = new Set(us2y.bars.map((b) => b.sessionDate));
  const shared = us10y.bars
    .map((b) => b.sessionDate)
    .filter((d) => dates2.has(d))
    .sort();
  const latest = shared.at(-1);
  if (!latest) {
    throw new Error("US2Y and US10Y share no session dates");
  }
  return latest;
}

export function assembleSnapshot(
  seriesList: readonly SymbolSeries[],
  config: RegimeSignatureConfig,
  options: {
    readonly marketSessionDate?: string;
    readonly generatedAt?: string;
  } = {},
): MacroSnapshot {
  const seriesBySymbol = new Map(
    seriesList.map((s) => [s.symbol, s] as const),
  );
  for (const symbol of ALL_SYMBOLS) {
    if (!seriesBySymbol.has(symbol)) {
      throw new Error(`missing series for ${symbol}`);
    }
  }

  const marketSessionDate =
    options.marketSessionDate ?? chooseMarketSession(seriesBySymbol);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const sourceDateByAsset: Partial<Record<MacroSymbol, string>> = {};
  const staleDaysByAsset: Partial<Record<MacroSymbol, number>> = {};
  const features: MacroFeature[] = [];
  const scoreInputs: ScoreInput[] = [];
  const barSources: MacroSnapshot["barSources"] = {};

  for (const symbol of ALL_SYMBOLS) {
    const series = seriesBySymbol.get(symbol)!;
    barSources[symbol] = {
      source: series.source,
      barCount: series.bars.length,
    };

    const sourceDate = latestOnOrBefore(series, marketSessionDate);
    if (sourceDate !== null) {
      sourceDateByAsset[symbol] = sourceDate;
      staleDaysByAsset[symbol] = sessionDistance(sourceDate, marketSessionDate);
    }

    const observations: DailyObservation[] = series.bars.map((b) => ({
      sessionDate: b.sessionDate,
      value: b.value,
    }));

    const feature = buildMacroFeature({
      symbol,
      observations,
      targetSession: marketSessionDate,
      sigmaFloor: config.sigmaFloors[symbol],
      windowLength: DEFAULT_WINDOW_LENGTH,
    });
    features.push(feature);

    scoreInputs.push({
      symbol,
      zScore: feature.zScore,
      stale: (staleDaysByAsset[symbol] ?? 0) > 0,
    });
  }

  const classification = classifyDriver(scoreInputs, config);

  const corePresentOnSession = CORE_SYMBOLS.filter(
    (s) => sourceDateByAsset[s] === marketSessionDate,
  ).length;
  const isCompleteSession = corePresentOnSession === CORE_SYMBOLS.length;

  let sessionAlignment: SessionAlignment;
  if (isCompleteSession) {
    sessionAlignment = "aligned";
  } else if (corePresentOnSession >= 6) {
    sessionAlignment = "partial";
  } else {
    sessionAlignment = "stale";
  }

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "MacroComputeSnapshot",
    marketSessionDate,
    generatedAt,
    sessionAlignment,
    isCompleteSession,
    sourceDateByAsset,
    staleDaysByAsset,
    methodology: {
      methodologyVersion: config.methodologyVersion,
      signatureVersion: config.signatureVersion,
      window: DEFAULT_WINDOW_LENGTH,
      excludesCurrentObservation: true,
      muAssumption: "zero",
      sigmaEstimator: "mad_about_zero_x1.4826",
      cosineRenormalizedOnObservedDims: true,
    },
    features,
    classification,
    barSources,
  };
}

/** Re-export for callers that want registry labels alongside the snapshot. */
export { ASSET_REGISTRY };
