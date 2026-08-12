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

export { readGammaFlipStrike } from "@/desk/format-gamma";
