import type { DominantDriver } from "@/contracts";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  type MarketInputSnapshot,
} from "@/contracts/market-input-snapshot";
import type { BoundedGammaDeskView } from "./load-bounded-gamma";
import type { BoundedGammaFreshnessLabel } from "./bounded-gamma-freshness";
import { wallStrikeWhenAvailable } from "./bounded-gamma-freshness";
import type { DurableBreadthReadOutcome } from "./breadth/read-durable-breadth";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import { deriveRiskDecisionV1 } from "./risk-decision-v1";
import {
  dealerFlowContextLines,
  dealerFlowRegimeLabel,
  estimateRestOfDayRange,
  estimateWallTouchProbabilities,
  formatOptionsDataCloseLabel,
  readGammaFlipStrike,
  resolveWallTouchDailyVolPct,
  summarizeCtaProxy,
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

export type V2DecisionStance = "buy" | "hold" | "reduce";
export type V2DecisionStatus =
  | "ready"
  | "methodology_preview"
  | "awaiting_inputs";

export interface V2CommandCenterView {
  readonly decisionStatus: V2DecisionStatus;
  readonly stance: V2DecisionStance | null;
  readonly riskScore: number | null;
  readonly riskChange: number | null;
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
  readonly macroLabel: string | null;
  readonly sessionDate: string | null;
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
  const displaySpot = resolveLiveEquitySpot(
    symbol,
    options.marketQuotes,
    snapshot.spot,
  );

  const base = {
    symbol,
    status: deskStatus,
    freshness,
    sessionDate: snapshot.sessionDate,
    expiration: snapshot.expiration,
    spot: displaySpot,
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

function eventGateFromMarketInput(
  snapshot: MarketInputSnapshot | null | undefined,
): EventGateSnapshot | null {
  if (!snapshot) return null;
  const field = snapshot.inputs.find((row) => row.key === "event_gate");
  if (!field?.value || typeof field.value !== "object") return null;
  const candidate = field.value as EventGateSnapshot;
  if (candidate.kind !== "EventGate") return null;
  return candidate;
}

export function buildV2CommandCenterView(input: {
  readonly driver: DominantDriver | null;
  readonly spyGamma: BoundedGammaDeskView;
  readonly qqqGamma: BoundedGammaDeskView;
  readonly methodologyPreview?: boolean;
  readonly spyBreadth?: V2SpyBreadthSummary;
  readonly marketQuotes?: readonly AlpacaMarketQuote[];
  readonly equityBarsBySymbol?: ReadonlyMap<
    string,
    readonly { sessionDate: string; close: number }[]
  >;
  readonly now?: Date;
  readonly marketInputSnapshot?: MarketInputSnapshot | null;
}): V2CommandCenterView {
  const preview = input.methodologyPreview === true;
  const now = input.now ?? new Date();
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
  const targetSession = resolveLastCompletedMarketSessionDate(now);

  if (preview) {
    return {
      decisionStatus: "methodology_preview",
      stance: "buy",
      riskScore: 42,
      riskChange: -6,
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
      ctaProxy,
      gamma: [spyGammaSummary, qqqGammaSummary],
      macroLabel: input.driver?.label ?? null,
      sessionDate: input.driver?.marketSessionDate ?? null,
    };
  }

  const decision = deriveRiskDecisionV1({
    driver: input.driver,
    spyBreadth,
    spyGamma: spyGammaSummary,
    ctaProxy,
    eventGate: eventGateFromMarketInput(input.marketInputSnapshot),
    targetSession,
  });

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

  return {
    decisionStatus: decision.status === "ready" ? "ready" : "awaiting_inputs",
    stance: decision.stance,
    riskScore: decision.riskScore,
    riskChange: null,
    opportunityScore: decision.opportunityScore,
    exposure: decision.exposure,
    allocation: decision.allocation,
    evidence,
    missingInputs: [...marketMissing, ...riskMissing],
    spyBreadth,
    ctaProxy,
    gamma: [spyGammaSummary, qqqGammaSummary],
    macroLabel: input.driver?.label ?? null,
    sessionDate: input.driver?.marketSessionDate ?? targetSession,
  };
}
