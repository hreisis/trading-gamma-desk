import {
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
  type GammaMethodology,
} from "@/contracts";

/**
 * OI-based GEX proxy (SpotGamma-style 1% move scaling).
 *
 *   unsignedUnitGex = gamma × OI × multiplier × spot² × 0.01
 *   callGex         = +unsignedUnitGex
 *   putGex          = −unsignedUnitGex
 *
 * Units: dollar exposure of a 1% underlying move under the OI×gamma proxy.
 */
export const GEX_PCT_MOVE = 0.01;

export const GEX_FORMULA =
  "unsignedUnitGex = gamma * openInterest * multiplier * spot^2 * 0.01; callGex = +unsignedUnitGex; putGex = -unsignedUnitGex; totalGex = sum(callGex)+sum(putGex)";

export const GEX_ASSUMPTIONS: readonly string[] = [
  "Puts are signed negative by convention in this OI-based proxy — not verified dealer positioning.",
  "Gamma and open interest are taken from the provider-neutral chain as reported; M4-1 does not recompute Black–Scholes gamma from IV.",
  "Contracts missing OI or gamma, expired vs sessionDate, or with non-finite / non-positive OI/gamma/multiplier/strike are excluded.",
  "Call wall = strike maximizing call GEX; put wall = strike minimizing put GEX (most negative put contribution).",
  "Gamma Flip is not estimated via strike interpolation; requires a future path that recomputes gamma from spot, IV, rates, and time-to-expiry.",
  "GEX is an amplifier/compressor structure estimate — not a directional buy/sell signal for the underlying.",
];

/** Relative |total| / sum(|strike net|) below this → near_zero regime. */
export const NEAR_ZERO_ABS_SHARE = 0.02;

export function gexMethodology(): GammaMethodology {
  return {
    id: GEX_METHODOLOGY_ID,
    version: GEX_METHODOLOGY_VERSION,
    formula: GEX_FORMULA,
    assumptions: [...GEX_ASSUMPTIONS],
  };
}
