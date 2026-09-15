/**
 * Positioning V2 — policy overlay on Risk / Opportunity / Trend.
 * Does not change Risk V1, Opportunity Score, or Risk Trend.
 */
import type { RiskTrendV2Label } from "@/desk/risk-trend-v2";

export const POSITIONING_V2_VERSION = "0.1.0";

export const POSITIONING_V2_LABELS = [
  "ADD",
  "SELECTIVE ADD",
  "HOLD / WAIT",
  "TACTICAL ADD",
  "HOLD",
  "TRIM / DEFENSIVE",
  "REDUCE CORE / TACTICAL REBOUND",
  "REDUCE",
] as const;

export type PositioningV2Label = (typeof POSITIONING_V2_LABELS)[number];

export function derivePositioningV2(input: {
  readonly riskScore: number | null;
  readonly opportunityScore: number | null;
  readonly trend: RiskTrendV2Label | null;
}): PositioningV2Label {
  const risk = input.riskScore;
  const opp = input.opportunityScore;
  if (risk === null || opp === null) return "HOLD / WAIT";

  if (risk <= 40) {
    if (opp >= 65) return "ADD";
    if (opp >= 45) return "SELECTIVE ADD";
    return "HOLD / WAIT";
  }

  if (risk <= 65) {
    if (input.trend === "deteriorating") return "TRIM / DEFENSIVE";
    if (opp >= 65 && input.trend === "improving") return "TACTICAL ADD";
    return "HOLD";
  }

  if (opp >= 65) return "REDUCE CORE / TACTICAL REBOUND";
  return "REDUCE";
}

const ADDITIVE_POSITIONING = new Set<PositioningV2Label>([
  "ADD",
  "SELECTIVE ADD",
  "TACTICAL ADD",
]);

const DEFENSIVE_POSITIONING = new Set<PositioningV2Label>([
  "TRIM / DEFENSIVE",
  "REDUCE CORE / TACTICAL REBOUND",
  "REDUCE",
]);

/** Display/critique helper. Does not change Positioning V2 scoring. */
export function positioningSessionAlignment(
  positioning: PositioningV2Label | null | undefined,
  direction: "up" | "down" | "flat" | null,
): { readonly kind: "worked" | "failed"; readonly line: string } | null {
  if (!positioning || (direction !== "up" && direction !== "down")) return null;
  if (ADDITIVE_POSITIONING.has(positioning)) {
    if (direction === "up") {
      return {
        kind: "worked",
        line: `Positioning ${positioning} aligned with a positive SPY session close.`,
      };
    }
    return {
      kind: "failed",
      line: `Positioning ${positioning} conflicted with a negative SPY session close.`,
    };
  }
  if (DEFENSIVE_POSITIONING.has(positioning)) {
    if (direction === "down") {
      return {
        kind: "worked",
        line: `Positioning ${positioning} aligned with a weaker SPY session close.`,
      };
    }
    return {
      kind: "failed",
      line: `Positioning ${positioning} conflicted with a positive SPY session close.`,
    };
  }
  return null;
}
