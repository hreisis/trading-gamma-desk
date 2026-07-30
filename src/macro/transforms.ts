import { ASSET_REGISTRY, MacroSymbol, Unit } from "@/contracts";

/**
 * Price assets use a simple return, not a log return, and yields use a plain
 * first difference in basis points. Neither is rounded here: rounding belongs
 * to presentation, and rounding before the z-score would move the number that
 * gets scored.
 */
export type ChangeKind = "simple_return" | "yield_diff";

export const PERCENT_PER_UNIT = 100;
export const BPS_PER_PERCENT = 100;

export function changeKindFor(symbol: MacroSymbol): ChangeKind {
  return ASSET_REGISTRY[symbol].unit === "bps" ? "yield_diff" : "simple_return";
}

/** Price assets must be finite and strictly positive; yields may be zero or negative. */
export function isValidObservation(value: number, kind: ChangeKind): boolean {
  if (!Number.isFinite(value)) return false;
  if (kind === "simple_return" && value <= 0) return false;
  return true;
}

/**
 * Returns the change in the asset's contract unit: percentage points for
 * `pct`, basis points for `bps`.
 */
export function computeChange(
  kind: ChangeKind,
  previous: number,
  current: number,
): number {
  if (kind === "yield_diff") {
    // Input yields are quoted in percent, so the difference scales to bps.
    return (current - previous) * BPS_PER_PERCENT;
  }
  const simpleReturn = current / previous - 1;
  return simpleReturn * PERCENT_PER_UNIT;
}

export function unitFor(symbol: MacroSymbol): Unit {
  return ASSET_REGISTRY[symbol].unit;
}
