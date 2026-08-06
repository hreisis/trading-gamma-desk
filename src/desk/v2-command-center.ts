import type { DominantDriver } from "@/contracts";
import type { BoundedGammaDeskView } from "./load-bounded-gamma";

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
  readonly gamma: readonly [V2GammaSummary, V2GammaSummary];
  readonly macroLabel: string | null;
  readonly sessionDate: string | null;
}

const MISSING_INPUTS = [
  "Breadth: SPY / Nasdaq / high-beta / semis",
  "VIX term structure and positioning",
  "Credit stress",
  "Relative leadership / inferred rotation",
  "Shock and event gate",
  "Versioned exposure policy",
] as const;

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
}): V2CommandCenterView {
  const preview = input.methodologyPreview === true;

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
    missingInputs: preview ? [] : MISSING_INPUTS,
    gamma: [
      summarizeGamma("SPY", input.spyGamma),
      summarizeGamma("QQQ", input.qqqGamma),
    ],
    macroLabel: input.driver?.label ?? null,
    sessionDate: input.driver?.marketSessionDate ?? null,
  };
}
