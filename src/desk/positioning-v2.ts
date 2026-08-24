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
