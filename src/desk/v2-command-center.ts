import type { DominantDriver } from "@/contracts";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import type { BoundedGammaDeskView } from "./load-bounded-gamma";
import type { DurableBreadthReadOutcome } from "./breadth/read-durable-breadth";

export type V2Language = "en" | "zh";

export interface V2GammaSummary {
  readonly symbol: "SPY" | "QQQ";
  readonly status: "ready" | "unavailable";
  readonly spot: number | null;
  readonly putWall: number | null;
  readonly callWall: number | null;
  readonly regime: string | null;
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
}

export interface V2CommandCenterView {
  readonly decisionStatus: "methodology_preview" | "awaiting_inputs";
  readonly stance: "selective_buy" | null;
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
  readonly gamma: readonly [V2GammaSummary, V2GammaSummary];
  readonly macroLabel: string | null;
  readonly sessionDate: string | null;
}

const STATIC_MISSING_INPUTS = [
  "Breadth: Nasdaq / high-beta / semis",
  "VIX term structure and positioning",
  "Credit stress",
  "Relative leadership / inferred rotation",
  "Shock and event gate",
  "Versioned exposure policy",
] as const;

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
  };

  if (publicDemo) {
    return {
      ...unavailableBase,
      missingReason: "SPY breadth is not computed on the public demo path.",
      sourceArtifact: null,
    };
  }

  const snapshot = outcome.snapshot;
  if (!snapshot) {
    return unavailableBase;
  }

  const status =
    snapshot.status === "available"
      ? "available"
      : snapshot.status === "partial"
        ? "partial"
        : "unavailable";
  const showValues = snapshot.status !== "unavailable";

  return {
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
  };
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

function wallStrike(
  wall:
    | NonNullable<BoundedGammaDeskView["snapshot"]>["boundedCallWall"]
    | NonNullable<BoundedGammaDeskView["snapshot"]>["boundedPutWall"],
): number | null {
  return wall.status === "unavailable" ? null : (wall.strike ?? null);
}

function summarizeGamma(
  symbol: "SPY" | "QQQ",
  view: BoundedGammaDeskView,
): V2GammaSummary {
  if (view.status !== "ready" || view.snapshot === null) {
    return {
      symbol,
      status: "unavailable",
      spot: null,
      putWall: null,
      callWall: null,
      regime: null,
      quality: view.error?.message ?? "Gamma snapshot unavailable.",
      source: view.sourceLabel,
      isFixture: view.isFixture,
    };
  }

  const snapshot = view.snapshot;
  return {
    symbol,
    status: "ready",
    spot: snapshot.spot,
    putWall: wallStrike(snapshot.boundedPutWall),
    callWall: wallStrike(snapshot.boundedCallWall),
    regime: snapshot.gammaRegime,
    quality: `${snapshot.status} · bounded single expiry · ${snapshot.coverage.contractsUsed}/${snapshot.coverage.contractsIn} contracts used`,
    source: view.sourceLabel,
    isFixture: view.isFixture,
  };
}

export function buildV2CommandCenterView(input: {
  readonly driver: DominantDriver | null;
  readonly spyGamma: BoundedGammaDeskView;
  readonly qqqGamma: BoundedGammaDeskView;
  readonly methodologyPreview?: boolean;
  readonly spyBreadth?: V2SpyBreadthSummary;
}): V2CommandCenterView {
  const preview = input.methodologyPreview === true;
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

  return {
    decisionStatus: preview ? "methodology_preview" : "awaiting_inputs",
    stance: preview ? "selective_buy" : null,
    riskScore: preview ? 42 : null,
    riskChange: preview ? -6 : null,
    opportunityScore: preview ? 58 : null,
    exposure: preview ? { min: 65, max: 80 } : null,
    allocation: preview
      ? { highBeta: 45, defense: 25, metals: 20, hedge: 10 }
      : null,
    evidence: preview
      ? [
          "Illustrative breadth is improving, but not broad enough for a strong-buy stance.",
          "Illustrative rates and credit inputs are stable; no shock override is active.",
          "Gamma is context only and does not create the directional call.",
        ]
      : [],
    missingInputs: preview ? [] : [...STATIC_MISSING_INPUTS],
    spyBreadth,
    gamma: [
      summarizeGamma("SPY", input.spyGamma),
      summarizeGamma("QQQ", input.qqqGamma),
    ],
    macroLabel: input.driver?.label ?? null,
    sessionDate: input.driver?.marketSessionDate ?? null,
  };
}
