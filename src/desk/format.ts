import {
  ASSET_REGISTRY,
  type AssetObservation,
  type Confidence,
  type DominantDriver,
  type MacroSymbol,
  type PrimaryRegime,
  type Unit,
} from "@/contracts";

const FALLBACKS = new Set<string>([
  "mixed_unresolved",
  "single_asset_shock",
  "insufficient_data",
]);

export function isFallbackRegime(regime: PrimaryRegime): boolean {
  return FALLBACKS.has(regime);
}

export function formatSignedChange(
  value: number | null,
  unit: Unit,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  if (unit === "bps") {
    const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
    return `${sign}${n} bps`;
  }
  return `${sign}${abs.toFixed(2)}%`;
}

export function formatZScore(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return "—";
  const sign = z > 0 ? "+" : z < 0 ? "−" : "";
  return `${sign}${Math.abs(z).toFixed(2)}`;
}

export function assetDisplayName(asset: AssetObservation): string {
  const label = ASSET_REGISTRY[asset.symbol as MacroSymbol]?.label ?? asset.symbol;
  if (asset.isProxy) {
    return `${label} via ${asset.instrument}`;
  }
  return label;
}

/**
 * Numeric score only. Never high/medium/low while uncalibrated.
 */
export function formatConfidenceScore(confidence: Confidence): string {
  const base = `${confidence.score}/100`;
  return confidence.calibrated ? base : `${base} (uncalibrated)`;
}

export function sessionBannerText(driver: DominantDriver): string {
  if (!driver.isCompleteSession || driver.sessionAlignment !== "aligned") {
    return `Latest complete macro snapshot · ${driver.marketSessionDate}`;
  }
  return `Macro session ${driver.marketSessionDate}`;
}

/** Explicit payload provenance for banner + API consumers. */
export function deskSourceLabel(
  source: "local_driver" | "fixture",
): "live driver" | "demo · fixture fallback" {
  return source === "local_driver"
    ? "live driver"
    : "demo · fixture fallback";
}

export function roleLabel(role: AssetObservation["role"]): string {
  switch (role) {
    case "confirming":
      return "Confirming";
    case "contradicting":
      return "Contradicting";
    case "neutral":
      return "Neutral";
    case "missing":
      return "Missing";
  }
}

export function regimeLabel(regime: PrimaryRegime | string): string {
  switch (regime) {
    case "fed_rates":
      return "Rates";
    case "inflation":
      return "Inflation";
    case "growth":
      return "Growth";
    case "liquidity":
      return "Liquidity";
    case "risk_sentiment":
      return "Risk sentiment";
    case "mixed_unresolved":
      return "Mixed / unresolved";
    case "single_asset_shock":
      return "Single-asset shock";
    case "insufficient_data":
      return "Insufficient data";
    default:
      return String(regime).replace(/_/g, " ");
  }
}

export function polarityLabel(polarity: string): string {
  if (polarity === "positive") return "Positive";
  if (polarity === "negative") return "Negative";
  return polarity;
}

export function riskDirectionLabel(direction: string): string {
  if (direction === "risk_on") return "Risk-on";
  if (direction === "risk_off") return "Risk-off";
  if (direction === "mixed") return "Mixed risk";
  return direction.replace(/_/g, " ");
}

export function confidenceComponentLabel(name: string): string {
  switch (name) {
    case "patternMatch":
      return "Pattern match";
    case "distinctiveness":
      return "Distinctiveness";
    case "coherence":
      return "Coherence";
    case "effectiveBreadth":
      return "Effective breadth";
    case "strength":
      return "Strength";
    default:
      return name.replace(/([A-Z])/g, " $1").trim();
  }
}

export function sessionAlignmentLabel(alignment: string): string {
  if (alignment === "aligned") return "Aligned";
  if (alignment === "partial") return "Partial";
  if (alignment === "stale") return "Stale";
  return alignment;
}
