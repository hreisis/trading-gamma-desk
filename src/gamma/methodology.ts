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
  "unsignedUnitGex = gamma * openInterest * multiplier * spot^2 * 0.01; callGex = +unsignedUnitGex; putGex = -unsignedUnitGex; totalGex = sum(callGex)+sum(putGex); grossGex = sum(|callGex|+|putGex|)";

export const GEX_ASSUMPTIONS: readonly string[] = [
  "Puts are signed negative by convention in this OI-based proxy — not verified dealer positioning.",
  "Gamma and open interest are taken from the provider-neutral chain as reported; M4-1 does not recompute Black–Scholes gamma from IV.",
  "OI=0 and gamma=0 are valid (contribute zero GEX). Missing, negative, or non-finite OI/gamma, expired contracts, and invalid strike/multiplier/spot are excluded.",
  "Call wall = strike maximizing call GEX among strikes with callGex > 0; ties break to the lowest strike. Put wall = strike minimizing put GEX among strikes with putGex < 0; ties break to the highest strike. All-zero GEX does not fabricate walls.",
  "Near-zero regime uses |totalGex| / grossGex where grossGex = Σ(|callGex|+|putGex|). 0DTE share = gross 0DTE GEX / gross total GEX (no clamping).",
  "Gamma Flip is not estimated via strike interpolation; requires a future path that recomputes gamma from spot, IV, rates, and time-to-expiry.",
  "GEX is an amplifier/compressor structure estimate — not a directional buy/sell signal for the underlying.",
];

/** Relative |total| / grossGex below this → near_zero regime. */
export const NEAR_ZERO_GROSS_SHARE = 0.02;

/** @deprecated Use NEAR_ZERO_GROSS_SHARE */
export const NEAR_ZERO_ABS_SHARE = NEAR_ZERO_GROSS_SHARE;

export function gexMethodology(): GammaMethodology {
  return {
    id: GEX_METHODOLOGY_ID,
    version: GEX_METHODOLOGY_VERSION,
    formula: GEX_FORMULA,
    assumptions: [...GEX_ASSUMPTIONS],
  };
}
