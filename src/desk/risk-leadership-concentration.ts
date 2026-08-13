/**
 * Leadership concentration penalty for Risk V1.
 *
 * Deterministic ladder (max +10, applied after base weighted score):
 *
 * Prerequisites — no penalty unless SPY breadth signal is available and
 * advancingPct, ma20, ma50 are all finite.
 *
 * 0 pts — Broad participation
 *   • advancingPct ≥ 60 AND ma20 ≥ 55 AND ma50 ≥ 50
 *   • If sector rotation is available and not stale:
 *       leading+improving ≥ 6 OR negative 5D RS count ≤ 2
 *
 * 0 pts — Index MA structure not “healthy”
 *   • ma20 < 60 OR ma50 < 60 (breadth factor already reflects weakness)
 *
 * Breadth-only (sector unavailable or stale) — conservative cap +3
 *   • advancingPct < 60, ma20 ≥ 60, ma50 ≥ 60 → +3 narrow participation
 *
 * Full ladder (advancingPct < 60, ma20 ≥ 60, ma50 ≥ 60):
 *   • advancingPct ≥ 45 → base +3 (mixed advance, strong MA breadth)
 *   • advancingPct < 45 → base +5
 *   • Upgrade to +6 if leadingCount ≤ 3 AND negativeRs5d ≥ 4
 *   • Upgrade to +8 if leading+improving ≤ 4 AND negativeRs5d ≥ 5
 *   • Upgrade to +10 if leading+improving ≤ 3 AND negativeRs5d ≥ 6
 *
 * Final penalty = min(computed, 10).
 */

import type { V2SectorRotationSummary } from "./v2-command-center";

export const LEADERSHIP_CONCENTRATION_PENALTY_CAP = 10;

export interface LeadershipConcentrationBreadthInput {
  readonly breadthSignalStatus: "available" | "unavailable";
  readonly advancingPct: number | null;
  readonly percentAboveMA20: number | null;
  readonly percentAboveMA50: number | null;
  readonly new20DayClosingHigh: number | null;
  readonly new20DayClosingLow: number | null;
}

export interface LeadershipConcentrationResult {
  readonly penalty: number;
  readonly reason: string | null;
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function countNegativeRs5d(
  sectors: readonly { readonly rs5d: number }[],
): number {
  return sectors.filter((row) => row.rs5d < 0).length;
}

function countLeading(sectors: readonly { readonly classification: string }[]): number {
  return sectors.filter((row) => row.classification === "leading").length;
}

function countLeadingImproving(
  sectors: readonly { readonly classification: string }[],
): number {
  return sectors.filter(
    (row) =>
      row.classification === "leading" || row.classification === "improving",
  ).length;
}

export function computeLeadershipConcentrationPenalty(input: {
  readonly breadth: LeadershipConcentrationBreadthInput;
  readonly sectorRotation: V2SectorRotationSummary | null | undefined;
}): LeadershipConcentrationResult {
  const { breadth, sectorRotation } = input;

  if (breadth.breadthSignalStatus !== "available") {
    return { penalty: 0, reason: null };
  }

  const advancingPct = breadth.advancingPct;
  const ma20 = breadth.percentAboveMA20;
  const ma50 = breadth.percentAboveMA50;

  if (!isFiniteNumber(advancingPct) || !isFiniteNumber(ma20) || !isFiniteNumber(ma50)) {
    return { penalty: 0, reason: null };
  }

  const broadBreadth =
    advancingPct >= 60 && ma20 >= 55 && ma50 >= 50;
  const strongMaBreadth = ma20 >= 60 && ma50 >= 60;
  const narrowAdvance = advancingPct < 60;

  const sectorUsable =
    sectorRotation !== null &&
    sectorRotation !== undefined &&
    sectorRotation.status === "available" &&
    !sectorRotation.stale &&
    sectorRotation.sectors.length > 0;

  if (broadBreadth) {
    if (!sectorUsable) {
      return { penalty: 0, reason: null };
    }
    const leadingImproving = countLeadingImproving(sectorRotation.sectors);
    const negativeRs5d = countNegativeRs5d(sectorRotation.sectors);
    if (leadingImproving >= 6 || negativeRs5d <= 2) {
      return { penalty: 0, reason: null };
    }
    return {
      penalty: 3,
      reason: "sector participation narrow",
    };
  }

  if (!strongMaBreadth) {
    return { penalty: 0, reason: null };
  }

  if (!narrowAdvance) {
    return { penalty: 0, reason: null };
  }

  let penalty = advancingPct >= 45 ? 3 : 5;
  let reason = "narrow participation";

  if (!sectorUsable) {
    return {
      penalty: Math.min(penalty, 3),
      reason: "narrow participation",
    };
  }

  const leadingCount = countLeading(sectorRotation.sectors);
  const leadingImproving = countLeadingImproving(sectorRotation.sectors);
  const negativeRs5d = countNegativeRs5d(sectorRotation.sectors);

  if (leadingCount <= 3 && negativeRs5d >= 4) {
    penalty = Math.max(penalty, 6);
    reason = "narrow leadership";
  }
  if (leadingImproving <= 4 && negativeRs5d >= 5) {
    penalty = Math.max(penalty, 8);
    reason = "narrow leadership";
  }
  if (leadingImproving <= 3 && negativeRs5d >= 6) {
    penalty = LEADERSHIP_CONCENTRATION_PENALTY_CAP;
    reason = "narrow leadership";
  }

  return {
    penalty: Math.min(penalty, LEADERSHIP_CONCENTRATION_PENALTY_CAP),
    reason,
  };
}

export function formatLeadershipConcentrationEvidence(
  penalty: number,
  reason: string | null,
): string | null {
  if (penalty <= 0 || reason === null) return null;
  return `+${penalty} concentration risk · ${reason}`;
}
