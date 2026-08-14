import type { DominantDriver } from "@/contracts";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  type MarketInputSnapshot,
} from "@/contracts/market-input-snapshot";
import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import {
  buildMacroDisplayInterpretation,
  patchMacroEvidenceForDisplay,
} from "./macro-display-returns";
import type { BoundedGammaDeskView } from "./load-bounded-gamma";
import type { BoundedGammaFreshnessLabel } from "./bounded-gamma-freshness";
import { wallStrikeWhenAvailable } from "./bounded-gamma-freshness";
import type { DurableBreadthReadOutcome } from "./breadth/read-durable-breadth";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import {
  resolveCurrentMarketSessionDate,
  resolveLastCompletedMarketSessionDate,
} from "@/ai-study/session";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import {
  deriveRiskDecisionV1,
  resolveRiskDecisionDayOverDay,
  resolveRiskDecisionDayOverDayAsync,
} from "./risk-decision-v1";
import {
  deriveRiskDecisionV1_1,
  unavailableQqqBreadthSummary,
  resolveRiskDivergenceDayOverDay,
  loadPriorPublishedRiskDivergence,
  type RiskComponentDivergence,
  type RiskDivergenceTrend,
} from "./risk-decision-v1-1";
import type { RuntimeJsonStore } from "./runtime-store";
import { buildGammaCone, type GammaConeResult } from "./gamma-cone";
import {
  dealerFlowContextLines,
  dealerFlowRegimeLabel,
  computeCloseMovingAverage,
  estimateRestOfDayRange,
  estimateWallTouchProbabilities,
  formatOptionsDataCloseLabel,
  readGammaFlipStrike,
  resolveWallTouchDailyVolPct,
  summarizeCtaProxy,
  summarizeSymbolCtaProxy,
  summarizeVolMispricing,
  type CtaProxySummary,
  type RestOfDayRange,
  type VolMispricingSummary,
  type WallTouchProbability,
} from "./format-gamma";

export type V2Language = "en" | "zh";

export interface V2GammaSummary {
  readonly symbol: "SPY" | "QQQ";
  readonly status: "ready" | "unavailable" | "incomplete";
  readonly freshness: BoundedGammaFreshnessLabel | null;
  readonly sessionDate: string | null;
  readonly expiration: string | null;
  readonly spot: number | null;
  readonly putWall: number | null;
  readonly callWall: number | null;
  readonly gammaFlip: number | null;
  readonly netGex: number | null;
  readonly regime: string | null;
  readonly dataLabel: string | null;
  readonly dealerFlowRegime: string | null;
  readonly contextLines: readonly string[];
  readonly callWallTouch: WallTouchProbability;
  readonly putWallTouch: WallTouchProbability;
  readonly restOfDayRange: RestOfDayRange;
  readonly volMispricing: VolMispricingSummary;
  readonly quality: string;
  readonly source: string;
  readonly isFixture: boolean;
}

export interface V2SpyBreadthSummary {
  readonly status: "available" | "partial" | "unavailable";
  readonly stale: boolean;
  readonly marketSessionDate: string | null;
  readonly asOf: string | null;
  readonly advance: number | null;
  readonly decline: number | null;
  readonly unchanged: number | null;
  readonly percentAboveMA20: number | null;
  readonly percentAboveMA50: number | null;
  readonly new20DayClosingHigh: number | null;
  readonly new20DayClosingLow: number | null;
  readonly missingReason: string | null;
  readonly sourceArtifact: string | null;
  readonly advancingPct: number | null;
  readonly breadthSignal: "strong" | "mixed" | "weak" | null;
  readonly breadthSignalStatus: "available" | "unavailable";
  readonly breadthContextLine: string | null;
}

export const SECTOR_ETF_SYMBOLS = [
  "XLK",
  "XLF",
  "XLE",
  "XLI",
  "XLV",
  "XLY",
  "XLP",
  "XLU",
  "XLB",
  "XLRE",
  "XLC",
] as const;

export const SECTOR_ROTATION_BENCHMARK_SYMBOL = "SPY";

export const SECTOR_ETF_NAMES: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLI: "Industrials",
  XLV: "Health Care",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLU: "Utilities",
  XLB: "Materials",
  XLRE: "Real Estate",
  XLC: "Communication Services",
};

export function formatSectorEtfLabel(symbol: string): string {
  const name = SECTOR_ETF_NAMES[symbol];
  return name ? `${symbol} · ${name}` : symbol;
}

/** Half-width scale for diverging relative-strength bars (min 0.5% keeps thin bars readable). */
export function sectorRotationBarScale(
  sectors: readonly V2SectorRotationRow[],
  minScale = 0.5,
): number {
  if (sectors.length === 0) return minScale;
  const maxAbs = Math.max(...sectors.map((row) => Math.abs(row.rs5d)));
  return Math.max(maxAbs, minScale);
}

export function sectorRotationBarWidthPct(rs5d: number, scale: number): number {
  return Math.min(50, (Math.abs(rs5d) / scale) * 50);
}

export function sectorRotationBarSymbols(): readonly string[] {
  return [SECTOR_ROTATION_BENCHMARK_SYMBOL, ...SECTOR_ETF_SYMBOLS];
}

export type V2SectorRotationClass =
  | "leading"
  | "improving"
  | "neutral"
  | "weakening";

export interface V2SectorRotationRow {
  readonly symbol: string;
  readonly classification: V2SectorRotationClass;
  readonly return1d: number;
  readonly return5d: number;
  readonly return20d: number;
  readonly rs1d: number;
  readonly rs5d: number;
  readonly rs20d: number;
  readonly aboveMa20: boolean;
  readonly aboveMa50: boolean;
}

export interface V2SectorRotationSummary {
  readonly status: "available" | "unavailable";
  readonly stale: boolean;
  readonly sessionDate: string | null;
  readonly sectors: readonly V2SectorRotationRow[];
  readonly topLeadingImproving: readonly V2SectorRotationRow[];
  readonly bottomWeakening: readonly V2SectorRotationRow[];
  readonly missingReason: string | null;
}

export type V2DecisionStance = "buy" | "hold" | "reduce";
export type V2DecisionStatus =
  | "ready"
  | "methodology_preview"
  | "awaiting_inputs";

export interface V2MacroSummary {
  readonly label: string;
  readonly primaryRegime: string;
  readonly riskDirection: string | null;
  readonly marketSessionDate: string | null;
  readonly interpretation: string | null;
  readonly evidence: readonly string[];
}

export interface V2CommandCenterView {
  readonly decisionStatus: V2DecisionStatus;
  readonly stance: V2DecisionStance | null;
  readonly riskScore: number | null;
  readonly riskChange: number | null;
  readonly riskChangeReason: string | null;
  readonly opportunityScore: number | null;
  readonly exposure: { readonly min: number; readonly max: number } | null;
  readonly allocation:
    | {
        readonly highBeta: number;
        readonly defense: number;
        readonly metals: number;
        readonly hedge: number;
      }
    | null;
  readonly evidence: readonly string[];
  readonly missingInputs: readonly string[];
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly ctaProxy: CtaProxySummary;
  readonly gamma: readonly [V2GammaSummary, V2GammaSummary];
  readonly gammaCone: readonly [GammaConeResult, GammaConeResult];
  readonly macroLabel: string | null;
  readonly macroSummary: V2MacroSummary | null;
  readonly sessionDate: string | null;
  readonly sectorRotation: V2SectorRotationSummary;
  /** SPY structural risk — symbol-specific factors + shared macro/event. */
  readonly spyStructuralRiskScore: number | null;
  /** QQQ structural risk — symbol-specific factors + shared macro/event. */
  readonly qqqStructuralRiskScore: number | null;
  /** QQQ structural risk minus SPY structural risk when both scores are available. */
  readonly riskDivergence: number | null;
  readonly riskDivergenceChange: number | null;
  readonly riskDivergenceTrend: RiskDivergenceTrend | null;
  readonly componentDivergence: RiskComponentDivergence;
  readonly qqqBreadth: V2SpyBreadthSummary;
}

export type V2AiStudyConfidence = "high" | "moderate" | "limited";

export interface V2AiStudyInterpretation {
  readonly status: "ready" | "fallback" | "preview" | "unavailable";
  readonly source: "openai" | "deterministic" | "preview" | "unavailable";
  readonly confidence: V2AiStudyConfidence;
  readonly dataLimitations: readonly string[];
  readonly regime: string;
  readonly baseCase: string;
  readonly ifThen: string;
  readonly invalidation: string;
  readonly tension: string;
  readonly missingReason: string | null;
}

const STATIC_MISSING_INPUTS = [
  "Breadth: Nasdaq / high-beta / semis",
  "VIX term structure and positioning",
  "Credit stress",
  "Relative leadership / inferred rotation",
] as const;

const NASDAQ_BREADTH_MISSING = "Breadth: Nasdaq / high-beta / semis";

export function deriveMissingInputsFromMarketSnapshot(
  snapshot: MarketInputSnapshot | null | undefined,
): readonly string[] {
  if (!snapshot) {
    return [NASDAQ_BREADTH_MISSING, ...STATIC_MISSING_INPUTS];
  }

  const missing = snapshot.inputs
    .filter((field) => field.status === "missing" || field.status === "unavailable")
    .map((field) =>
      field.missingReason
        ? `${field.label}: ${field.missingReason}`
        : field.label,
    );

  missing.push(NASDAQ_BREADTH_MISSING);

  return missing;
}

function deriveEvidenceFromDriver(
  driver: DominantDriver | null,
): readonly string[] {
  if (!driver) return [];
  const lines: string[] = [];
  if (driver.interpretation.text.trim()) {
    lines.push(driver.interpretation.text.trim());
  }
  for (const item of driver.evidence.slice(0, 4)) {
    if (item.statement.trim()) {
      lines.push(item.statement.trim());
    }
  }
  return lines;
}

export function summarizeMacroFromDriver(
  driver: DominantDriver | null,
  options?: {
    readonly marketQuotes?: readonly AlpacaMarketQuote[];
    readonly now?: Date;
  },
): V2MacroSummary | null {
  if (!driver) return null;
  const now = options?.now ?? new Date();
  const patchedEvidence = patchMacroEvidenceForDisplay(driver, {
    marketQuotes: options?.marketQuotes,
    now,
  });
  const interpretation = buildMacroDisplayInterpretation(
    driver,
    patchedEvidence,
    now,
  );
  const evidence = patchedEvidence
    .map((item) => item.statement.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
  return {
    label: driver.label,
    primaryRegime: driver.primaryRegime,
    riskDirection: driver.riskDirection,
    marketSessionDate: driver.marketSessionDate,
    interpretation: interpretation.length > 0 ? interpretation : null,
    evidence,
  };
}

const BREADTH_STRONG_ADVANCE_PCT = 60;
const BREADTH_WEAK_ADVANCE_PCT = 45;
const BREADTH_STRONG_MA20_PCT = 55;
const BREADTH_STRONG_MA50_PCT = 50;
const BREADTH_WEAK_MA20_PCT = 40;
const BREADTH_WEAK_MA50_PCT = 40;

function deriveAdvancingPct(
  advance: number | null,
  decline: number | null,
  unchanged: number | null,
): number | null {
  if (advance === null || decline === null || unchanged === null) {
    return null;
  }
  const total = advance + decline + unchanged;
  if (total <= 0) return null;
  return Math.round((advance / total) * 1000) / 10;
}

function deriveBreadthContextLine(
  advancingPct: number,
  signal: "strong" | "mixed" | "weak",
): string {
  const rounded = Math.round(advancingPct);
  switch (signal) {
    case "strong":
      return `${rounded}% advancing · broad participation`;
    case "weak":
      return `${rounded}% advancing · participation weakening`;
    case "mixed":
      return `${rounded}% advancing · mixed participation`;
  }
}

export function deriveBreadthActionableSignal(
  summary: V2SpyBreadthSummary,
): Pick<
  V2SpyBreadthSummary,
  | "advancingPct"
  | "breadthSignal"
  | "breadthSignalStatus"
  | "breadthContextLine"
> {
  const unavailable = {
    advancingPct: null,
    breadthSignal: null,
    breadthSignalStatus: "unavailable" as const,
    breadthContextLine: null,
  };

  if (summary.status === "unavailable" || summary.stale) {
    if (summary.status === "unavailable") {
      return unavailable;
    }
  }

  const advancingPct = deriveAdvancingPct(
    summary.advance,
    summary.decline,
    summary.unchanged,
  );
  const ma20 = summary.percentAboveMA20;
  const ma50 = summary.percentAboveMA50;

  if (advancingPct === null || ma20 === null || ma50 === null) {
    return unavailable;
  }

  let signal: "strong" | "mixed" | "weak";
  if (
    advancingPct >= BREADTH_STRONG_ADVANCE_PCT &&
    ma20 >= BREADTH_STRONG_MA20_PCT &&
    ma50 >= BREADTH_STRONG_MA50_PCT
  ) {
    signal = "strong";
  } else if (
    advancingPct < BREADTH_WEAK_ADVANCE_PCT ||
    ma20 < BREADTH_WEAK_MA20_PCT ||
    ma50 < BREADTH_WEAK_MA50_PCT
  ) {
    signal = "weak";
  } else {
    signal = "mixed";
  }

  return {
    advancingPct,
    breadthSignal: signal,
    breadthSignalStatus: "available",
    breadthContextLine: deriveBreadthContextLine(advancingPct, signal),
  };
}

function withBreadthSignal(summary: V2SpyBreadthSummary): V2SpyBreadthSummary {
  return {
    ...summary,
    ...deriveBreadthActionableSignal(summary),
  };
}

function resolveLiveEquitySpot(
  symbol: "SPY" | "QQQ",
  marketQuotes: readonly AlpacaMarketQuote[] | undefined,
  gammaSpot: number | null,
): number | null {
  const quote = marketQuotes?.find((row) => row.symbol === symbol);
  if (
    quote?.status === "available" &&
    quote.latestPrice !== null &&
    Number.isFinite(quote.latestPrice) &&
    quote.latestPrice > 0
  ) {
    return quote.latestPrice;
  }

  if (
    gammaSpot !== null &&
    Number.isFinite(gammaSpot) &&
    gammaSpot > 0
  ) {
    return gammaSpot;
  }

  return null;
}

function computeRestOfDayRange(
  symbol: "SPY" | "QQQ",
  options: {
    readonly driver: DominantDriver | null;
    readonly now: Date;
    readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
    readonly gammaSpot: number | null;
  },
): RestOfDayRange {
  const spot = resolveLiveEquitySpot(
    symbol,
    options.marketQuotes,
    options.gammaSpot,
  );
  return estimateRestOfDayRange({
    spot,
    dailyVolPct: resolveWallTouchDailyVolPct(options.driver, symbol),
    now: options.now,
  });
}

function summarizeVolMispricingForSymbol(
  symbol: "SPY" | "QQQ",
  view: BoundedGammaDeskView,
  options: {
    readonly equityBarsBySymbol:
      | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
      | undefined;
  },
): VolMispricingSummary {
  const ivSnapshot = view.snapshot ?? view.withheldSnapshot;
  return summarizeVolMispricing({
    representativeIv: ivSnapshot?.representativeIv,
    hv20Bars: options.equityBarsBySymbol?.get(symbol),
    isFixture: view.isFixture,
  });
}

function summarizeSymbolCtaProxyFromInputs(input: {
  readonly symbol: "SPY" | "QQQ";
  readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
  readonly equityBarsBySymbol:
    | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
    | undefined;
  readonly now: Date;
}): CtaProxySummary {
  const price = resolveLiveEquitySpot(input.symbol, input.marketQuotes, null);
  const targetSession = resolveLastCompletedMarketSessionDate(input.now);
  const bars = input.equityBarsBySymbol?.get(input.symbol);
  const spyBars = input.equityBarsBySymbol?.get("SPY");

  return summarizeSymbolCtaProxy({
    symbol: input.symbol,
    bars,
    price,
    targetSession,
    hv20BenchmarkBars: input.symbol === "SPY" ? bars : spyBars,
  });
}

function summarizeCtaProxyFromInputs(input: {
  readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
  readonly equityBarsBySymbol:
    | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
    | undefined;
  readonly now: Date;
}): CtaProxySummary {
  const spyPrice = resolveLiveEquitySpot("SPY", input.marketQuotes, null);
  const qqqPrice = resolveLiveEquitySpot("QQQ", input.marketQuotes, null);
  const targetSession = resolveLastCompletedMarketSessionDate(input.now);

  return summarizeCtaProxy({
    spyBars: input.equityBarsBySymbol?.get("SPY"),
    qqqBars: input.equityBarsBySymbol?.get("QQQ"),
    spyPrice,
    qqqPrice,
    targetSession,
  });
}

function metricPercent(
  metric:
    | {
        readonly numerator: number;
        readonly denominator: number;
        readonly status: string;
      }
    | undefined,
): number | null {
  if (!metric || metric.status === "unavailable") return null;
  if (metric.denominator === 0) return null;
  return Math.round((metric.numerator / metric.denominator) * 1000) / 10;
}

export function summarizeSpyBreadthFromDurable(
  outcome: DurableBreadthReadOutcome,
  publicDemo: boolean,
): V2SpyBreadthSummary {
  const unavailableBase: V2SpyBreadthSummary = {
    status: "unavailable",
    stale: false,
    marketSessionDate: null,
    asOf: null,
    advance: null,
    decline: null,
    unchanged: null,
    percentAboveMA20: null,
    percentAboveMA50: null,
    new20DayClosingHigh: null,
    new20DayClosingLow: null,
    missingReason: outcome.missingReason,
    sourceArtifact: outcome.sourceArtifact,
    advancingPct: null,
    breadthSignal: null,
    breadthSignalStatus: "unavailable",
    breadthContextLine: null,
  };

  if (publicDemo) {
    return withBreadthSignal({
      ...unavailableBase,
      missingReason: "SPY breadth is not computed on the public demo path.",
      sourceArtifact: null,
    });
  }

  const snapshot = outcome.snapshot;
  if (!snapshot) {
    return withBreadthSignal(unavailableBase);
  }

  const status =
    snapshot.status === "available"
      ? "available"
      : snapshot.status === "partial"
        ? "partial"
        : "unavailable";
  const showValues = snapshot.status !== "unavailable";

  return withBreadthSignal({
    status,
    stale: snapshot.stale,
    marketSessionDate: snapshot.marketSessionDate,
    asOf: snapshot.asOf,
    advance: showValues ? snapshot.advance : null,
    decline: showValues ? snapshot.decline : null,
    unchanged: showValues ? snapshot.unchanged : null,
    percentAboveMA20: showValues
      ? metricPercent(snapshot.metrics.percentAboveMA20)
      : null,
    percentAboveMA50: showValues
      ? metricPercent(snapshot.metrics.percentAboveMA50)
      : null,
    new20DayClosingHigh: showValues
      ? metricPercent(snapshot.metrics.new20DayClosingHigh)
      : null,
    new20DayClosingLow: showValues
      ? metricPercent(snapshot.metrics.new20DayClosingLow)
      : null,
    missingReason: snapshot.missingReason ?? outcome.missingReason,
    sourceArtifact: outcome.sourceArtifact,
    advancingPct: null,
    breadthSignal: null,
    breadthSignalStatus: "unavailable",
    breadthContextLine: null,
  });
}

export function breadthSignalLabel(
  signal: V2SpyBreadthSummary["breadthSignal"],
  status: V2SpyBreadthSummary["breadthSignalStatus"],
): string {
  if (status !== "available" || signal === null) return "unavailable";
  switch (signal) {
    case "strong":
      return "Strong";
    case "mixed":
      return "Mixed";
    case "weak":
      return "Weak";
  }
}

/** Maps a loaded breadth snapshot into the command-center field shape. */
export function summarizeSpyBreadthFromSnapshot(
  snapshot: BreadthInternalsSnapshot | null | undefined,
  options?: {
    readonly sourceArtifact?: string | null;
    readonly missingReason?: string | null;
    readonly publicDemo?: boolean;
  },
): V2SpyBreadthSummary {
  return summarizeSpyBreadthFromDurable(
    {
      snapshot: snapshot ?? null,
      sourceArtifact: options?.sourceArtifact ?? null,
      missingReason: options?.missingReason ?? null,
    },
    options?.publicDemo === true,
  );
}

function summarizeGammaFromSnapshot(
  symbol: "SPY" | "QQQ",
  snapshot: BoundedGammaProviderSnapshot,
  view: BoundedGammaDeskView,
  options: {
    readonly driver: DominantDriver | null;
    readonly now: Date;
    readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
    readonly equityBarsBySymbol:
      | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
      | undefined;
  },
): V2GammaSummary {
  const deskStatus: V2GammaSummary["status"] =
    snapshot.status === "incomplete"
      ? "incomplete"
      : snapshot.status === "unavailable"
        ? "unavailable"
        : "ready";
  const freshness =
    view.freshness ??
    (snapshot.status === "incomplete" ? "incomplete" : "fresh");
  const showFlow = deskStatus === "ready" || deskStatus === "incomplete";

  const base = {
    symbol,
    status: deskStatus,
    freshness,
    sessionDate: snapshot.sessionDate,
    expiration: snapshot.expiration,
    spot: snapshot.spot,
    putWall: showFlow ? wallStrikeWhenAvailable(snapshot.boundedPutWall) : null,
    callWall: showFlow ? wallStrikeWhenAvailable(snapshot.boundedCallWall) : null,
    regime: showFlow ? snapshot.gammaRegime : null,
    quality: `${snapshot.status} · bounded single expiry · ${snapshot.coverage.contractsUsed}/${snapshot.coverage.contractsIn} contracts used`,
    source: view.sourceLabel,
    isFixture: view.isFixture,
  };

  if (!showFlow) {
    return {
      ...base,
      gammaFlip: null,
      netGex: null,
      dataLabel: formatOptionsDataCloseLabel(snapshot.sessionDate, view.isFixture),
      dealerFlowRegime: null,
      contextLines: [],
      callWallTouch: { status: "unavailable", percent: null },
      putWallTouch: { status: "unavailable", percent: null },
      restOfDayRange: computeRestOfDayRange(symbol, {
        driver: options.driver,
        now: options.now,
        marketQuotes: options.marketQuotes,
        gammaSpot: snapshot.spot,
      }),
      volMispricing: summarizeVolMispricingForSymbol(symbol, view, {
        equityBarsBySymbol: options.equityBarsBySymbol,
      }),
    };
  }

  return withDealerFlowFields(base, snapshot, view, options);
}

function summarizeGammaUnavailable(
  symbol: "SPY" | "QQQ",
  view: BoundedGammaDeskView,
  options: {
    readonly driver: DominantDriver | null;
    readonly now: Date;
    readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
    readonly equityBarsBySymbol:
      | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
      | undefined;
  },
): V2GammaSummary {
  return {
    symbol,
    status: "unavailable",
    freshness: view.freshness ?? null,
    sessionDate: null,
    expiration: null,
    spot: null,
    putWall: null,
    callWall: null,
    gammaFlip: null,
    netGex: null,
    regime: null,
    dataLabel: null,
    dealerFlowRegime: null,
    contextLines: [],
    callWallTouch: { status: "unavailable", percent: null },
    putWallTouch: { status: "unavailable", percent: null },
    restOfDayRange: computeRestOfDayRange(symbol, {
      driver: options.driver,
      now: options.now,
      marketQuotes: options.marketQuotes,
      gammaSpot: view.snapshot?.spot ?? view.withheldSnapshot?.spot ?? null,
    }),
    volMispricing: summarizeVolMispricingForSymbol(symbol, view, {
      equityBarsBySymbol: options.equityBarsBySymbol,
    }),
    quality: view.error?.message ?? "Gamma snapshot unavailable.",
    source: view.sourceLabel,
    isFixture: view.isFixture,
  };
}

function withDealerFlowFields(
  base: Omit<
    V2GammaSummary,
    | "gammaFlip"
    | "netGex"
    | "dataLabel"
    | "dealerFlowRegime"
    | "contextLines"
    | "callWallTouch"
    | "putWallTouch"
    | "restOfDayRange"
    | "volMispricing"
  >,
  snapshot: BoundedGammaProviderSnapshot,
  view: BoundedGammaDeskView,
  options: {
    readonly driver: DominantDriver | null;
    readonly now: Date;
    readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
    readonly equityBarsBySymbol:
      | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
      | undefined;
  },
): V2GammaSummary {
  const callWall = wallStrikeWhenAvailable(snapshot.boundedCallWall);
  const putWall = wallStrikeWhenAvailable(snapshot.boundedPutWall);
  const flipStrike = readGammaFlipStrike(snapshot);

  const touch =
    base.status === "ready" && base.freshness === "fresh"
      ? estimateWallTouchProbabilities({
          spot: snapshot.spot,
          callWallStrike: callWall,
          callWallAvailable: snapshot.boundedCallWall.status === "available",
          putWallStrike: putWall,
          putWallAvailable: snapshot.boundedPutWall.status === "available",
          sessionDate: snapshot.sessionDate,
          symbol: base.symbol,
          now: options.now,
          dailyVolPct: resolveWallTouchDailyVolPct(options.driver, base.symbol),
        })
      : {
          callWallTouch: { status: "unavailable" as const, percent: null },
          putWallTouch: { status: "unavailable" as const, percent: null },
        };

  return {
    ...base,
    gammaFlip: flipStrike,
    netGex: snapshot.totalGex,
    dataLabel: formatOptionsDataCloseLabel(snapshot.sessionDate, view.isFixture),
    dealerFlowRegime: dealerFlowRegimeLabel(snapshot.gammaRegime),
    contextLines: dealerFlowContextLines({
      spot: snapshot.spot,
      callWall,
      putWall,
      flipStrike,
      regime: snapshot.gammaRegime,
    }),
    callWallTouch: touch.callWallTouch,
    putWallTouch: touch.putWallTouch,
    restOfDayRange: computeRestOfDayRange(base.symbol, {
      driver: options.driver,
      now: options.now,
      marketQuotes: options.marketQuotes,
      gammaSpot: snapshot.spot,
    }),
    volMispricing: summarizeVolMispricingForSymbol(base.symbol, view, {
      equityBarsBySymbol: options.equityBarsBySymbol,
    }),
  };
}

function summarizeGamma(
  symbol: "SPY" | "QQQ",
  view: BoundedGammaDeskView,
  options: {
    readonly driver: DominantDriver | null;
    readonly now: Date;
    readonly marketQuotes: readonly AlpacaMarketQuote[] | undefined;
    readonly equityBarsBySymbol:
      | ReadonlyMap<string, readonly { sessionDate: string; close: number }[]>
      | undefined;
  },
): V2GammaSummary {
  const snapshot = view.snapshot ?? view.withheldSnapshot;
  if (snapshot === null) {
    return summarizeGammaUnavailable(symbol, view, options);
  }

  return summarizeGammaFromSnapshot(symbol, snapshot, view, options);
}

export function eventGateFromMarketInput(
  snapshot: MarketInputSnapshot | null | undefined,
): EventGateSnapshot | null {
  if (!snapshot) return null;
  const field = snapshot.inputs.find((row) => row.key === "event_gate");
  if (!field?.value || typeof field.value !== "object") return null;
  const candidate = field.value as EventGateSnapshot;
  if (candidate.kind !== "EventGate") return null;
  return candidate;
}

const SECTOR_ROTATION_UNAVAILABLE: V2SectorRotationSummary = {
  status: "unavailable",
  stale: false,
  sessionDate: null,
  sectors: [],
  topLeadingImproving: [],
  bottomWeakening: [],
  missingReason: "Sector rotation daily bars not loaded.",
};

function closesEndingAtTargetSession(
  bars: readonly { sessionDate: string; close: number }[],
  targetSession: string,
  count: number,
): number[] {
  const filtered = bars.filter((bar) => bar.sessionDate <= targetSession);
  if (filtered.length < count) return [];
  if (filtered.at(-1)?.sessionDate !== targetSession) return [];
  return filtered.slice(-count).map((bar) => bar.close);
}

function sessionCloseReturnPct(
  bars: readonly { sessionDate: string; close: number }[],
  targetSession: string,
  lookbackSessions: number,
): number | null {
  const closes = closesEndingAtTargetSession(
    bars,
    targetSession,
    lookbackSessions + 1,
  );
  if (closes.length < lookbackSessions + 1) return null;
  const start = closes[0];
  const end = closes[closes.length - 1];
  if (start === undefined || end === undefined) return null;
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null;
  return ((end / start) - 1) * 100;
}

/** Deterministic sector rotation classification (evaluated in priority order). */
export function classifySectorRotationRow(
  rs1d: number,
  rs5d: number,
  aboveMa20: boolean,
  aboveMa50: boolean,
): V2SectorRotationClass {
  if (rs5d > 0 && aboveMa20 && aboveMa50) return "leading";
  if (rs5d < 0 && !aboveMa20 && !aboveMa50) return "weakening";
  if (rs1d > 0) return "improving";
  return "neutral";
}

export function summarizeSectorRotation(input: {
  readonly equityBarsBySymbol?: ReadonlyMap<
    string,
    readonly { sessionDate: string; close: number }[]
  >;
  readonly targetSession: string;
  readonly barPanelLatestSession?: string | null;
}): V2SectorRotationSummary {
  const map = input.equityBarsBySymbol;
  if (!map) {
    return SECTOR_ROTATION_UNAVAILABLE;
  }

  const spyBars = map.get(SECTOR_ROTATION_BENCHMARK_SYMBOL);
  if (!spyBars || spyBars.length === 0) {
    return {
      ...SECTOR_ROTATION_UNAVAILABLE,
      missingReason: "SPY benchmark bars unavailable.",
    };
  }

  const spy1d = sessionCloseReturnPct(spyBars, input.targetSession, 1);
  const spy5d = sessionCloseReturnPct(spyBars, input.targetSession, 5);
  const spy20d = sessionCloseReturnPct(spyBars, input.targetSession, 20);
  if (spy1d === null || spy5d === null || spy20d === null) {
    return {
      ...SECTOR_ROTATION_UNAVAILABLE,
      missingReason: `Insufficient SPY history for ${input.targetSession}.`,
    };
  }

  const sectors: V2SectorRotationRow[] = [];
  for (const symbol of SECTOR_ETF_SYMBOLS) {
    const bars = map.get(symbol);
    if (!bars || bars.length === 0) continue;

    const filtered = bars.filter((bar) => bar.sessionDate <= input.targetSession);
    if (filtered.at(-1)?.sessionDate !== input.targetSession) continue;

    const close = filtered.at(-1)!.close;
    const ma20 = computeCloseMovingAverage(filtered, 20);
    const ma50 = computeCloseMovingAverage(filtered, 50);
    if (ma20 === null || ma50 === null) continue;

    const return1d = sessionCloseReturnPct(bars, input.targetSession, 1);
    const return5d = sessionCloseReturnPct(bars, input.targetSession, 5);
    const return20d = sessionCloseReturnPct(bars, input.targetSession, 20);
    if (return1d === null || return5d === null || return20d === null) continue;

    const rs1d = return1d - spy1d;
    const rs5d = return5d - spy5d;
    const rs20d = return20d - spy20d;
    const aboveMa20 = close > ma20;
    const aboveMa50 = close > ma50;

    sectors.push({
      symbol,
      classification: classifySectorRotationRow(rs1d, rs5d, aboveMa20, aboveMa50),
      return1d,
      return5d,
      return20d,
      rs1d,
      rs5d,
      rs20d,
      aboveMa20,
      aboveMa50,
    });
  }

  if (sectors.length === 0) {
    return {
      ...SECTOR_ROTATION_UNAVAILABLE,
      missingReason: `No sector ETF bars aligned to ${input.targetSession}.`,
    };
  }

  const spyAlignedLast =
    spyBars.filter((bar) => bar.sessionDate <= input.targetSession).at(-1)
      ?.sessionDate ?? null;
  const panelLatest = input.barPanelLatestSession;
  const effectivePanelLatest =
    panelLatest !== null &&
    panelLatest !== undefined &&
    panelLatest <= input.targetSession
      ? panelLatest
      : null;
  const latestSession = effectivePanelLatest ?? spyAlignedLast;
  const stale =
    latestSession !== null && latestSession !== input.targetSession;

  const sortedByRs5d = [...sectors].sort((left, right) => right.rs5d - left.rs5d);
  const topLeadingImproving = sortedByRs5d
    .filter(
      (row) =>
        row.classification === "leading" || row.classification === "improving",
    )
    .slice(0, 3);
  const bottomWeakening = [...sectors]
    .filter((row) => row.classification === "weakening")
    .sort((left, right) => left.rs5d - right.rs5d)
    .slice(0, 3);

  return {
    status: "available",
    stale,
    sessionDate: input.targetSession,
    sectors,
    topLeadingImproving,
    bottomWeakening,
    missingReason: null,
  };
}

function previewSectorRotationSummary(): V2SectorRotationSummary {
  const rows: V2SectorRotationRow[] = [
    {
      symbol: "XLK",
      classification: "leading",
      return1d: 0.8,
      return5d: 2.4,
      return20d: 4.1,
      rs1d: 0.5,
      rs5d: 1.2,
      rs20d: 2.0,
      aboveMa20: true,
      aboveMa50: true,
    },
    {
      symbol: "XLI",
      classification: "improving",
      return1d: 0.6,
      return5d: -0.4,
      return20d: 1.0,
      rs1d: 0.3,
      rs5d: -0.8,
      rs20d: -0.5,
      aboveMa20: true,
      aboveMa50: false,
    },
    {
      symbol: "XLY",
      classification: "improving",
      return1d: 0.4,
      return5d: -0.2,
      return20d: 0.8,
      rs1d: 0.1,
      rs5d: -0.6,
      rs20d: -0.3,
      aboveMa20: false,
      aboveMa50: false,
    },
    {
      symbol: "XLP",
      classification: "weakening",
      return1d: -0.5,
      return5d: -1.8,
      return20d: -2.5,
      rs1d: -0.8,
      rs5d: -2.4,
      rs20d: -3.1,
      aboveMa20: false,
      aboveMa50: false,
    },
    {
      symbol: "XLU",
      classification: "weakening",
      return1d: -0.3,
      return5d: -1.2,
      return20d: -1.9,
      rs1d: -0.6,
      rs5d: -1.8,
      rs20d: -2.4,
      aboveMa20: false,
      aboveMa50: false,
    },
    {
      symbol: "XLRE",
      classification: "weakening",
      return1d: -0.2,
      return5d: -1.0,
      return20d: -1.5,
      rs1d: -0.5,
      rs5d: -1.6,
      rs20d: -2.0,
      aboveMa20: false,
      aboveMa50: false,
    },
  ];

  return {
    status: "available",
    stale: false,
    sessionDate: "2026-07-30",
    sectors: rows,
    topLeadingImproving: rows
      .filter(
        (row) =>
          row.classification === "leading" || row.classification === "improving",
      )
      .slice(0, 3),
    bottomWeakening: rows
      .filter((row) => row.classification === "weakening")
      .slice(0, 3),
    missingReason: null,
  };
}

export async function buildV2CommandCenterView(input: {
  readonly driver: DominantDriver | null;
  readonly spyGamma: BoundedGammaDeskView;
  readonly qqqGamma: BoundedGammaDeskView;
  readonly methodologyPreview?: boolean;
  readonly spyBreadth?: V2SpyBreadthSummary;
  readonly qqqBreadth?: V2SpyBreadthSummary;
  readonly marketQuotes?: readonly AlpacaMarketQuote[];
  readonly equityBarsBySymbol?: ReadonlyMap<
    string,
    readonly { sessionDate: string; close: number }[]
  >;
  readonly now?: Date;
  readonly marketInputSnapshot?: MarketInputSnapshot | null;
  readonly dataRoot?: string | null;
  readonly barPanelLatestSession?: string | null;
  readonly artifactStore?: RuntimeJsonStore;
  readonly forceRiskDecisionDaily?: boolean;
}): Promise<V2CommandCenterView> {
  const preview = input.methodologyPreview === true;
  const now = input.now ?? new Date();
  const macroSummary = summarizeMacroFromDriver(input.driver, {
    marketQuotes: input.marketQuotes,
    now,
  });
  const gammaOptions = {
    driver: input.driver,
    now,
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
  };
  const spyBreadth =
    input.spyBreadth ??
    summarizeSpyBreadthFromDurable(
      {
        snapshot: null,
        sourceArtifact: null,
        missingReason: "SPY breadth was not loaded.",
      },
      false,
    );

  const spyGammaSummary = summarizeGamma("SPY", input.spyGamma, gammaOptions);
  const qqqGammaSummary = summarizeGamma("QQQ", input.qqqGamma, gammaOptions);
  const ctaProxy = summarizeCtaProxyFromInputs({
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
    now,
  });
  const spyCtaProxy = summarizeSymbolCtaProxyFromInputs({
    symbol: "SPY",
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
    now,
  });
  const qqqCtaProxy = summarizeSymbolCtaProxyFromInputs({
    symbol: "QQQ",
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
    now,
  });
  const qqqBreadth =
    input.qqqBreadth ??
    summarizeSpyBreadthFromDurable(
      {
        snapshot: null,
        sourceArtifact: null,
        missingReason: unavailableQqqBreadthSummary().missingReason,
      },
      false,
    );
  const spyGammaCone = buildGammaCone({
    symbol: "SPY",
    view: input.spyGamma,
    now,
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
  });
  const qqqGammaCone = buildGammaCone({
    symbol: "QQQ",
    view: input.qqqGamma,
    now,
    marketQuotes: input.marketQuotes,
    equityBarsBySymbol: input.equityBarsBySymbol,
  });
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const sectorRotationInput = {
    equityBarsBySymbol: input.equityBarsBySymbol,
    targetSession,
    barPanelLatestSession: input.barPanelLatestSession,
  };

  if (preview) {
    const previewComponentDivergence: RiskComponentDivergence = {
      gammaRegime: { spy: null, qqq: null, label: null },
      ivHvSpread: {
        spySpreadVolPts: null,
        qqqSpreadVolPts: null,
        spreadDivergencePts: null,
      },
      breadth: { spy: null, qqq: null, label: null },
      relativePerformance: { qqqVsSpy1dPct: null, qqqVsSpy5dPct: null },
    };
    return {
      decisionStatus: "methodology_preview",
      stance: "buy",
      riskScore: 42,
      riskChange: -6,
      riskChangeReason: "Risk eased: breadth improved · CTA strengthened",
      opportunityScore: 58,
      exposure: { min: 65, max: 80 },
      allocation: { highBeta: 45, defense: 25, metals: 20, hedge: 10 },
      evidence: [
        "Illustrative breadth is improving, but not broad enough for a strong-buy stance.",
        "Illustrative rates and credit inputs are stable; no shock override is active.",
        "Gamma is context only and does not create the directional call.",
      ],
      missingInputs: [],
      spyBreadth,
      qqqBreadth,
      ctaProxy,
      gamma: [spyGammaSummary, qqqGammaSummary],
      gammaCone: [spyGammaCone, qqqGammaCone],
      macroLabel: macroSummary?.label ?? input.driver?.label ?? null,
      macroSummary,
      sessionDate: input.driver?.marketSessionDate ?? null,
      sectorRotation: previewSectorRotationSummary(),
      spyStructuralRiskScore: 48,
      qqqStructuralRiskScore: 66,
      riskDivergence: 18,
      riskDivergenceChange: 4,
      riskDivergenceTrend: "widening",
      componentDivergence: previewComponentDivergence,
    };
  }

  const sectorRotation = summarizeSectorRotation(sectorRotationInput);
  const eventGate = eventGateFromMarketInput(input.marketInputSnapshot);
  const publicationDate = resolveCurrentMarketSessionDate(now);
  const priorDivergence =
    input.dataRoot !== null && input.dataRoot !== undefined
      ? loadPriorPublishedRiskDivergence(input.dataRoot, publicationDate)
      : null;

  const riskV1_1 = deriveRiskDecisionV1_1({
    driver: input.driver,
    spyBreadth,
    qqqBreadth,
    spyGamma: spyGammaSummary,
    qqqGamma: qqqGammaSummary,
    marketCtaProxy: ctaProxy,
    spyCtaProxy,
    qqqCtaProxy,
    eventGate,
    sectorRotation,
    targetSession,
    equityBarsBySymbol: input.equityBarsBySymbol,
    priorDivergence,
  });
  const decision = riskV1_1.marketRisk;

  const driverEvidence = deriveEvidenceFromDriver(input.driver);
  const evidence =
    decision.status === "ready"
      ? [...decision.evidence, ...driverEvidence.slice(0, 2)]
      : driverEvidence;

  const marketMissing = deriveMissingInputsFromMarketSnapshot(
    input.marketInputSnapshot,
  );
  const riskMissing =
    decision.status === "withheld"
      ? decision.withheldFactors.map((factor) => `Risk model: ${factor}`)
      : [];

  const dayOverDay =
    decision.status === "ready"
      ? input.artifactStore
        ? await resolveRiskDecisionDayOverDayAsync({
            artifactStore: input.artifactStore,
            dataRoot: input.dataRoot,
            publicationDate,
            decisionSessionDate: targetSession,
            today: decision,
            now,
            force: input.forceRiskDecisionDaily === true,
          })
        : resolveRiskDecisionDayOverDay({
            dataRoot: input.dataRoot,
            publicationDate,
            decisionSessionDate: targetSession,
            today: decision,
            now,
            force: input.forceRiskDecisionDaily === true,
          })
      : { riskChange: null, riskChangeReason: null };

  resolveRiskDivergenceDayOverDay({
    dataRoot: input.dataRoot,
    publicationDate,
    decisionSessionDate: targetSession,
    result: riskV1_1,
    now,
    force: input.forceRiskDecisionDaily === true,
  });

  return {
    decisionStatus: decision.status === "ready" ? "ready" : "awaiting_inputs",
    stance: decision.stance,
    riskScore: decision.riskScore,
    riskChange: dayOverDay.riskChange,
    riskChangeReason: dayOverDay.riskChangeReason,
    opportunityScore: decision.opportunityScore,
    exposure: decision.exposure,
    allocation: decision.allocation,
    evidence,
    missingInputs: [...marketMissing, ...riskMissing],
    spyBreadth,
    qqqBreadth,
    ctaProxy,
    gamma: [spyGammaSummary, qqqGammaSummary],
    gammaCone: [spyGammaCone, qqqGammaCone],
    macroLabel: macroSummary?.label ?? input.driver?.label ?? null,
    macroSummary,
    sessionDate: publicationDate,
    sectorRotation,
    spyStructuralRiskScore: riskV1_1.spyStructuralRisk.riskScore,
    qqqStructuralRiskScore: riskV1_1.qqqStructuralRisk.riskScore,
    riskDivergence: riskV1_1.riskDivergence,
    riskDivergenceChange: riskV1_1.riskDivergenceChange,
    riskDivergenceTrend: riskV1_1.riskDivergenceTrend,
    componentDivergence: riskV1_1.componentDivergence,
  };
}
