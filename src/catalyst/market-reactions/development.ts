import type { ReactionDevelopment, ReactionDirection } from "@/contracts";
import {
  DEVELOPMENT_EXTEND_DELTA_PCT,
  DEVELOPMENT_FADE_DELTA_PCT,
  DEVELOPMENT_HOLD_BAND_PCT,
} from "./rules";

/**
 * Path classification between two cumulative % changes vs the same baseline.
 * Describes observed path only — never "market accepted/rejected" language.
 */
export function classifyDevelopmentPath(options: {
  readonly earlierPct: number | null | undefined;
  readonly laterPct: number | null | undefined;
  readonly earlierDirection: ReactionDirection;
  readonly laterDirection: ReactionDirection;
  readonly extendDeltaPct?: number;
  readonly fadeDeltaPct?: number;
  readonly holdBandPct?: number;
}): ReactionDevelopment {
  const {
    earlierPct,
    laterPct,
    earlierDirection,
    laterDirection,
  } = options;
  const extendDelta = options.extendDeltaPct ?? DEVELOPMENT_EXTEND_DELTA_PCT;
  const fadeDelta = options.fadeDeltaPct ?? DEVELOPMENT_FADE_DELTA_PCT;
  const holdBand = options.holdBandPct ?? DEVELOPMENT_HOLD_BAND_PCT;

  if (
    earlierDirection === "unavailable" ||
    laterDirection === "unavailable" ||
    earlierPct === null ||
    earlierPct === undefined ||
    laterPct === null ||
    laterPct === undefined ||
    !Number.isFinite(earlierPct) ||
    !Number.isFinite(laterPct)
  ) {
    return "unavailable";
  }

  // Clear reverse across deadband classifications.
  if (
    (earlierDirection === "up" && laterDirection === "down") ||
    (earlierDirection === "down" && laterDirection === "up")
  ) {
    return "reversed";
  }

  // Flat → directional: path developed.
  if (earlierDirection === "flat" && (laterDirection === "up" || laterDirection === "down")) {
    return "extended";
  }
  // Directional → flat: path faded into deadband.
  if ((earlierDirection === "up" || earlierDirection === "down") && laterDirection === "flat") {
    return "faded";
  }
  // Both flat.
  if (earlierDirection === "flat" && laterDirection === "flat") {
    return "held";
  }

  // Same directional side.
  if (
    (earlierDirection === "up" && laterDirection === "up") ||
    (earlierDirection === "down" && laterDirection === "down")
  ) {
    const absE = Math.abs(earlierPct);
    const absL = Math.abs(laterPct);
    if (absL >= absE + extendDelta) return "extended";
    if (absL <= absE - fadeDelta) return "faded";
    if (Math.abs(absL - absE) <= holdBand) return "held";
    // Between hold and extend/fade bands — still same direction: held.
    return "held";
  }

  return "mixed";
}

/**
 * Aggregate equity-proxy developments: if symbols disagree (excluding
 * unavailable), return mixed; if all unavailable → unavailable; else majority.
 */
export function aggregateEquityDevelopment(
  paths: readonly ReactionDevelopment[],
): ReactionDevelopment {
  const usable = paths.filter((p) => p !== "unavailable");
  if (usable.length === 0) return "unavailable";
  const unique = new Set(usable);
  if (unique.size === 1) return usable[0]!;
  return "mixed";
}
