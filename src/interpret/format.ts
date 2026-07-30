import { ASSET_REGISTRY, type MacroSymbol, type Unit } from "@/contracts";

/** Format a change for evidence prose. Kept stable so the numeric guardrail can match. */
export function formatChange(value: number, unit: Unit): string {
  if (unit === "bps") {
    const rounded = Math.round(value);
    const abs = Math.abs(rounded);
    const verb = rounded > 0 ? "rose" : rounded < 0 ? "fell" : "was unchanged at";
    if (rounded === 0) return `${verb} 0 bps`;
    return `${verb} ${abs} bps`;
  }
  const rounded = Math.round(value * 100) / 100;
  const abs = Math.abs(rounded).toFixed(2);
  const verb = rounded > 0 ? "rose" : rounded < 0 ? "fell" : "was unchanged at";
  if (rounded === 0) return `${verb} 0.00%`;
  return `${verb} ${abs}%`;
}

export function formatZ(zScore: number | null): string {
  if (zScore === null) return "z unavailable";
  return `z = ${zScore.toFixed(2)}`;
}

export function assetDisplayName(symbol: MacroSymbol): string {
  const def = ASSET_REGISTRY[symbol];
  if (def.isProxy) return `${def.label} via ${def.instrument}`;
  return def.label;
}

/**
 * Pull decimal numerals from prose for the guardrail. Deliberately ignores
 * lone years that look like 20xx when they appear as session dates elsewhere.
 */
export function extractNumerals(text: string): string[] {
  return text.match(/-?\d+(?:\.\d+)?/g) ?? [];
}
