import type { ReactionDirection } from "@/contracts";

/**
 * Atomic direction from a percent change and display deadband.
 * Boundary: exactly ±deadband → flat (conservative).
 */
export function classifyDirection(
  changePct: number | null | undefined,
  deadbandPct: number,
): ReactionDirection {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) {
    return "unavailable";
  }
  if (changePct > deadbandPct) return "up";
  if (changePct < -deadbandPct) return "down";
  return "flat";
}
