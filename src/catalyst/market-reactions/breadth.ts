import type { EquityBreadth, ReactionDirection } from "@/contracts";

/**
 * Equity breadth over SPY/QQQ/IWM only.
 *
 * Majority rule (locked by tests):
 * - Need ≥2 available directions (not unavailable).
 * - broadly_higher: ≥ majority same-direction "up" AND zero "down".
 * - broadly_lower: ≥ majority same-direction "down" AND zero "up".
 * - majority = floor(availableCount / 2) + 1
 *   (for 2 → 2; for 3 → 2).
 * - Any opposing up+down → mixed.
 * - All available flat → flat.
 * - Otherwise (e.g. one up + flats without majority) → unavailable.
 *
 * A single QQQ up with SPY/IWM missing or flat is never "broadly_higher".
 */
export function classifyEquityBreadth(
  directions: ReadonlyArray<ReactionDirection>,
): EquityBreadth {
  const available = directions.filter((d) => d !== "unavailable");
  if (available.length < 2) return "unavailable";

  const ups = available.filter((d) => d === "up").length;
  const downs = available.filter((d) => d === "down").length;
  const flats = available.filter((d) => d === "flat").length;
  // Strict majority: floor(n/2)+1 → 2 of 2, 2 of 3.
  const majority = Math.floor(available.length / 2) + 1;

  if (ups > 0 && downs > 0) return "mixed";
  if (flats === available.length) return "flat";
  if (ups >= majority && downs === 0) return "broadly_higher";
  if (downs >= majority && ups === 0) return "broadly_lower";
  return "unavailable";
}

/** Map equity breadth to cross-asset equities leg. */
export function breadthToCrossAssetLeg(
  breadth: EquityBreadth,
): "higher" | "lower" | "mixed" | "flat" | "unavailable" {
  switch (breadth) {
    case "broadly_higher":
      return "higher";
    case "broadly_lower":
      return "lower";
    case "mixed":
      return "mixed";
    case "flat":
      return "flat";
    case "unavailable":
      return "unavailable";
  }
}
