import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import type { BoundedGammaProviderSnapshot } from "@/contracts";

export type BoundedGammaFreshnessLabel = "fresh" | "stale" | "incomplete";

/** Target session for bounded gamma freshness (last completed US equity session). */
export function resolveBoundedGammaTargetSession(now = new Date()): string {
  return resolveLastCompletedMarketSessionDate(now);
}

export function isBoundedGammaSessionStale(
  snapshotSessionDate: string,
  targetSession: string,
): boolean {
  return snapshotSessionDate < targetSession;
}

export function boundedGammaFreshnessLabel(
  snapshot: BoundedGammaProviderSnapshot,
  targetSession: string,
): BoundedGammaFreshnessLabel {
  if (isBoundedGammaSessionStale(snapshot.sessionDate, targetSession)) {
    return "stale";
  }
  if (snapshot.status === "incomplete") {
    return "incomplete";
  }
  return "fresh";
}

/**
 * Strike for desk display when the bounded wall row carries a finite strike.
 * Incomplete/partial walls still include derived strikes — only omit unavailable.
 */
export function wallStrikeWhenAvailable(
  wall: BoundedGammaProviderSnapshot["boundedCallWall"],
): number | null {
  if (wall.status === "unavailable") return null;
  const strike = wall.strike;
  if (strike === undefined || !Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  return strike;
}
