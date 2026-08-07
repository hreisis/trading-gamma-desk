import type { BoundedGammaProviderSnapshot } from "@/contracts";

export function gammaRegimeStabilityLabel(
  regime: BoundedGammaProviderSnapshot["gammaRegime"],
): string {
  switch (regime) {
    case "positive":
      return "STABLE";
    case "negative":
      return "VOLATILE";
    case "near_zero":
      return "TRANSITION";
    case "unavailable":
      return "—";
  }
}

export function gammaRegimeSignLabel(
  regime: BoundedGammaProviderSnapshot["gammaRegime"],
): string {
  switch (regime) {
    case "positive":
      return "+GAMMA";
    case "negative":
      return "−GAMMA";
    case "near_zero":
      return "~FLIP";
    case "unavailable":
      return "—";
  }
}

/** Bounded snapshot has no gamma flip field — only show when contract adds it later. */
export function readGammaFlipStrike(
  snapshot: BoundedGammaProviderSnapshot,
): number | null {
  const candidate = snapshot as BoundedGammaProviderSnapshot & {
    gammaFlip?: { status?: string; strike?: number | null };
  };
  const flip = candidate.gammaFlip;
  if (!flip || flip.status === "unavailable" || flip.strike == null) {
    return null;
  }
  if (!Number.isFinite(flip.strike)) return null;
  return flip.strike;
}
