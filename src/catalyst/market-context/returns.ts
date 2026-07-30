/**
 * Uniform pct-change rounding for market-context windows.
 * Uses 4 decimal places of percent (e.g. 0.1234 → 0.12% display can truncate later).
 */
export function pctChangeFromPrices(
  baseline: number,
  later: number,
): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(later)) return null;
  if (baseline === 0) return null;
  const raw = ((later - baseline) / baseline) * 100;
  return roundPct(raw);
}

export function roundPct(value: number): number {
  // Half-away-from-zero to 4 decimal places of percent points.
  const factor = 10_000;
  return Math.round(value * factor + Number.EPSILON * Math.sign(value)) / factor;
}
