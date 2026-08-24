/**
 * Opportunity Score V2 — separate from Risk Decision V1.
 * Higher = more tactical washout / dislocation opportunity, not a buy signal.
 * Missing factors are omitted and remaining weights are renormalized.
 */
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { VolMispricingSummary } from "./format-gamma";

export const OPPORTUNITY_V2_VERSION = "0.1.0";
export const OPPORTUNITY_V2_MODEL_WEIGHT = 100;

export const OPPORTUNITY_V2_WEIGHTS = {
  dislocation: 35,
  vol_stress: 20,
  breadth_washout: 20,
  gamma_convexity: 15,
  event_risk: 10,
} as const;

export type OpportunityV2FactorId = keyof typeof OPPORTUNITY_V2_WEIGHTS;

export interface OpportunityGammaInput {
  readonly status: "ready" | "unavailable" | "incomplete";
  readonly spot: number | null;
  readonly gammaFlip: number | null;
  readonly regime: string | null;
  readonly volMispricing: VolMispricingSummary;
}

export interface OpportunityBreadthInput {
  readonly breadthSignalStatus: "available" | "unavailable";
  readonly breadthSignal: "strong" | "mixed" | "weak" | null;
  readonly advancingPct: number | null;
}

export interface OpportunityV2Factor {
  readonly id: OpportunityV2FactorId;
  readonly score: number;
  readonly weight: number;
  readonly detail: string;
}

export interface OpportunityV2Result {
  readonly opportunityScore: number | null;
  readonly coverage: number;
  readonly factors: readonly OpportunityV2Factor[];
  readonly missing: readonly OpportunityV2FactorId[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function pctBelowFlip(spot: number, flip: number): number | null {
  if (!(flip > 0) || !Number.isFinite(spot) || !Number.isFinite(flip)) return null;
  return ((flip - spot) / flip) * 100;
}

function dislocationScore(
  spy: OpportunityGammaInput | null,
  qqq: OpportunityGammaInput | null,
): { score: number; detail: string } | null {
  const samples: { label: string; pct: number }[] = [];
  for (const [label, gamma] of [
    ["SPY", spy],
    ["QQQ", qqq],
  ] as const) {
    if (!gamma || gamma.status === "unavailable") continue;
    if (gamma.spot === null || gamma.gammaFlip === null) continue;
    const pct = pctBelowFlip(gamma.spot, gamma.gammaFlip);
    if (pct === null) continue;
    samples.push({ label, pct });
  }
  if (samples.length === 0) return null;
  const mean = samples.reduce((sum, row) => sum + row.pct, 0) / samples.length;
  // 50 at the flip; +25 per 1% below flip (2% below → 100, 2% above → 0).
  const score = roundScore(50 + 25 * mean);
  const parts = samples.map((row) => {
    const abs = Math.abs(row.pct).toFixed(2);
    return row.pct >= 0
      ? `${row.label} ${abs}% below flip`
      : `${row.label} ${abs}% above flip`;
  });
  return { score, detail: parts.join(" · ") };
}

function volStressScore(
  spy: OpportunityGammaInput | null,
): { score: number; detail: string } | null {
  const vol = spy?.volMispricing;
  if (!vol || vol.status !== "available") return null;
  if (vol.spreadVolPts !== null && Number.isFinite(vol.spreadVolPts)) {
    const score = roundScore(50 + 8 * vol.spreadVolPts);
    return {
      score,
      detail: `IV−HV ${vol.spreadVolPts >= 0 ? "+" : ""}${vol.spreadVolPts} vol · ${vol.signal ?? "—"}`,
    };
  }
  if (vol.signal === "vol_expensive") {
    return { score: 80, detail: "Vol expensive" };
  }
  if (vol.signal === "balanced") {
    return { score: 45, detail: "Balanced vol" };
  }
  if (vol.signal === "vol_underpriced") {
    return { score: 20, detail: "Vol underpriced" };
  }
  return null;
}

function breadthWashoutScore(
  breadth: OpportunityBreadthInput | null,
): { score: number; detail: string } | null {
  if (!breadth || breadth.breadthSignalStatus !== "available") return null;
  if (breadth.advancingPct !== null && Number.isFinite(breadth.advancingPct)) {
    const score = roundScore(100 - breadth.advancingPct);
    return {
      score,
      detail: `${breadth.advancingPct.toFixed(1)}% advancing · ${breadth.breadthSignal ?? "—"}`,
    };
  }
  if (breadth.breadthSignal === "weak") {
    return { score: 85, detail: "Weak breadth" };
  }
  if (breadth.breadthSignal === "mixed") {
    return { score: 50, detail: "Mixed breadth" };
  }
  if (breadth.breadthSignal === "strong") {
    return { score: 20, detail: "Strong breadth" };
  }
  return null;
}

function gammaConvexityScore(
  spy: OpportunityGammaInput | null,
): { score: number; detail: string } | null {
  if (!spy || spy.status === "unavailable" || spy.regime === null) return null;
  if (spy.regime === "negative") {
    return { score: 80, detail: "Negative GEX · amplifying convexity" };
  }
  if (spy.regime === "near_zero") {
    return { score: 50, detail: "Near-zero GEX · transition convexity" };
  }
  if (spy.regime === "positive") {
    return { score: 25, detail: "Positive GEX · stabilizing / less convex" };
  }
  return null;
}

function eventOpportunityScore(
  eventGate: EventGateSnapshot | null,
): { score: number; detail: string } | null {
  if (!eventGate || eventGate.status === "unavailable") return null;
  if (eventGate.state === "clear") {
    return { score: 100, detail: "No active shock window" };
  }
  if (eventGate.state === "scheduled_risk") {
    return { score: 35, detail: "Scheduled high-impact window" };
  }
  if (eventGate.state === "active_shock") {
    return { score: 0, detail: "Active shock window" };
  }
  return null;
}

export function deriveOpportunityScoreV2(input: {
  readonly spyGamma?: OpportunityGammaInput | null;
  readonly qqqGamma?: OpportunityGammaInput | null;
  readonly breadth?: OpportunityBreadthInput | null;
  readonly eventGate?: EventGateSnapshot | null;
}): OpportunityV2Result {
  const spy = input.spyGamma ?? null;
  const qqq = input.qqqGamma ?? null;
  const candidates: {
    id: OpportunityV2FactorId;
    computed: { score: number; detail: string } | null;
  }[] = [
    { id: "dislocation", computed: dislocationScore(spy, qqq) },
    { id: "vol_stress", computed: volStressScore(spy) },
    { id: "breadth_washout", computed: breadthWashoutScore(input.breadth ?? null) },
    { id: "gamma_convexity", computed: gammaConvexityScore(spy) },
    { id: "event_risk", computed: eventOpportunityScore(input.eventGate ?? null) },
  ];

  const factors: OpportunityV2Factor[] = [];
  const missing: OpportunityV2FactorId[] = [];
  for (const row of candidates) {
    if (!row.computed) {
      missing.push(row.id);
      continue;
    }
    factors.push({
      id: row.id,
      score: row.computed.score,
      weight: OPPORTUNITY_V2_WEIGHTS[row.id],
      detail: row.computed.detail,
    });
  }

  const coverage = factors.reduce((sum, row) => sum + row.weight, 0);
  if (coverage <= 0) {
    return {
      opportunityScore: null,
      coverage: 0,
      factors: [],
      missing,
    };
  }

  const weighted =
    factors.reduce((sum, row) => sum + row.score * row.weight, 0) / coverage;
  return {
    opportunityScore: roundScore(weighted),
    coverage,
    factors,
    missing,
  };
}
