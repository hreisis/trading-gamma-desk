/**
 * Deterministic risk traffic lights for desk UI (M3-1.5).
 *
 * Lights describe implication for high-beta risk assets (e.g. BTC / growth
 * cyclicals / equity risk proxies) — not bare up/down price coloring.
 * Derivation uses existing structured fields only; insufficient data → gray.
 */

export type RiskLightKind = "green" | "yellow" | "red" | "gray";

export type RiskLightLabel =
  | "Risk Supportive"
  | "Mixed / Caution"
  | "Risk Warning"
  | "Unavailable";

export interface RiskTrafficLight {
  readonly kind: RiskLightKind;
  readonly label: RiskLightLabel;
}

export const RISK_LIGHT_BY_KIND: Record<RiskLightKind, RiskTrafficLight> = {
  green: { kind: "green", label: "Risk Supportive" },
  yellow: { kind: "yellow", label: "Mixed / Caution" },
  red: { kind: "red", label: "Risk Warning" },
  gray: { kind: "gray", label: "Unavailable" },
};

/**
 * Canonical high-beta risk weights (mirror regime-signature riskVector).
 * Positive weight: rising print supports risk assets. Negative: rising print
 * warns for risk assets (e.g. VIX). Symbols absent → no mapping → gray.
 */
export const HIGH_BETA_RISK_WEIGHTS: Readonly<Record<string, number>> = {
  BTC: 0.6,
  COPPER: 0.5,
  VIX: -0.8,
  USD: -0.4,
  GOLD: -0.2,
};

/** Matches uncalibrated z noise floor used in macro scoring. */
export const RISK_LIGHT_Z_NOISE = 0.5;

const FALLBACK_REGIMES = new Set([
  "mixed_unresolved",
  "single_asset_shock",
  "insufficient_data",
]);

function light(kind: RiskLightKind): RiskTrafficLight {
  return RISK_LIGHT_BY_KIND[kind];
}

/** Dominant Driver section light from riskDirection + data adequacy. */
export function deriveDriverRiskLight(input: {
  readonly primaryRegime: string;
  readonly riskDirection: "risk_on" | "risk_off" | "mixed" | null;
  readonly confidenceScore: number;
  readonly zeroedBy?: string | null;
}): RiskTrafficLight {
  if (FALLBACK_REGIMES.has(input.primaryRegime)) return light("gray");
  if (input.zeroedBy) return light("gray");
  if (!Number.isFinite(input.confidenceScore) || input.confidenceScore <= 0) {
    return light("gray");
  }
  if (input.riskDirection === null) return light("gray");
  if (input.riskDirection === "risk_on") return light("green");
  if (input.riskDirection === "risk_off") return light("red");
  return light("yellow");
}

/**
 * Per-asset Cross-Asset Moves light.
 * Uses z-score × risk weight — never bare % direction.
 */
export function deriveAssetRiskLight(input: {
  readonly symbol: string;
  readonly zScore: number | null;
  readonly role: string;
  readonly staleDays?: number | null;
}): RiskTrafficLight {
  if (input.role === "missing") return light("gray");
  if (input.zScore === null || !Number.isFinite(input.zScore)) {
    return light("gray");
  }
  if (input.staleDays !== null && input.staleDays !== undefined && input.staleDays > 0) {
    return light("gray");
  }

  const weight = HIGH_BETA_RISK_WEIGHTS[input.symbol] ?? 0;
  if (weight === 0) return light("gray");

  if (Math.abs(input.zScore) < RISK_LIGHT_Z_NOISE) return light("yellow");

  const implication = input.zScore * weight;
  if (implication > 0) return light("green");
  if (implication < 0) return light("red");
  return light("yellow");
}

/**
 * Released / developing / resolved catalyst light from observed reaction
 * structure (core equity breadth + leadership). Upcoming / no data → gray.
 * Does not use catalyst.direction or bare ETF % signs.
 */
export function deriveCatalystRiskLight(input: {
  readonly status: string;
  readonly equityBreadth?: string | null;
  readonly equityLeadershipStatus?: string | null;
}): RiskTrafficLight {
  if (
    input.status !== "released" &&
    input.status !== "developing" &&
    input.status !== "resolved"
  ) {
    return light("gray");
  }

  const breadth = input.equityBreadth;
  if (!breadth || breadth === "unavailable") return light("gray");

  const leadership = input.equityLeadershipStatus ?? "no_clear_leader";
  if (leadership === "unavailable") return light("gray");

  if (breadth === "mixed" || breadth === "flat") return light("yellow");

  if (breadth === "broadly_higher") {
    if (leadership === "mixed") return light("yellow");
    return light("green");
  }

  if (breadth === "broadly_lower") {
    if (leadership === "mixed") return light("yellow");
    return light("red");
  }

  return light("gray");
}
