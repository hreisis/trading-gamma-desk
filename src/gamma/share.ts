/** Minimal float tolerance for shareOfGrossGex ∈ [0, 1]. */
export const SHARE_OF_GROSS_GEX_EPS = 1e-9;

/**
 * Validates and normalizes gross 0DTE share for contract output.
 * Values within epsilon of 0 or 1 snap to bounds; otherwise must be in [0, 1].
 */
export function normalizeShareOfGrossGex(raw: number): number {
  if (!Number.isFinite(raw)) {
    throw new Error(`shareOfGrossGex must be finite, got ${raw}`);
  }
  if (raw < -SHARE_OF_GROSS_GEX_EPS) {
    throw new Error(`shareOfGrossGex out of range [0,1]: ${raw}`);
  }
  if (raw > 1 + SHARE_OF_GROSS_GEX_EPS) {
    throw new Error(`shareOfGrossGex out of range [0,1]: ${raw}`);
  }
  if (raw <= SHARE_OF_GROSS_GEX_EPS) return 0;
  if (raw >= 1 - SHARE_OF_GROSS_GEX_EPS) return 1;
  return raw;
}
