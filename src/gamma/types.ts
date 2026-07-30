import type { GammaDataDelay } from "@/contracts";

/**
 * Provider-neutral options chain types (M4-1).
 * Adapters for MarketData.app / Tradier / etc. map into these shapes later.
 */

export type OptionRight = "call" | "put";

export interface OptionsContract {
  /** Provider or OCC symbol — opaque to the engine. */
  readonly symbol: string;
  readonly underlying: string;
  /** Expiry calendar date YYYY-MM-DD (exchange listing date). */
  readonly expiry: string;
  readonly strike: number;
  readonly right: OptionRight;
  /** Open interest in contracts; null when the provider omitted it. */
  readonly openInterest: number | null;
  readonly volume?: number | null;
  /**
   * Per-unit gamma (∂Δ/∂S). Null when Greeks are missing.
   * Engine does not recompute Black–Scholes gamma in M4-1.
   */
  readonly gamma: number | null;
  /** Implied vol as decimal (e.g. 0.18). Reserved for future flip recompute. */
  readonly iv?: number | null;
  /** Contract multiplier (equity/ETF typically 100). */
  readonly multiplier: number;
}

export interface OptionsChainSource {
  /** Stable provider id: fixture | marketdata_app | tradier | … */
  readonly provider: string;
  readonly name: string;
  readonly fetchedAt: string;
}

/**
 * Normalized chain snapshot. Compute reads only this — never a vendor DTO.
 */
export interface OptionsChainSnapshot {
  readonly kind: "OptionsChainSnapshot";
  readonly underlying: string;
  /** Quote / snapshot timestamp. */
  readonly asOf: string;
  /** US equity session date the structure is labeled for. */
  readonly sessionDate: string;
  readonly spot: number | null;
  readonly dataDelay: GammaDataDelay;
  readonly source: OptionsChainSource;
  readonly contracts: readonly OptionsContract[];
  readonly synthetic: boolean;
}

export type ContractSkipReason =
  | "expired"
  | "missing_oi"
  | "missing_gamma"
  | "non_finite_oi"
  | "non_finite_gamma"
  | "negative_oi"
  | "negative_gamma"
  | "invalid_strike"
  | "invalid_multiplier"
  | "underlying_mismatch"
  | "missing_spot";

export interface ContractGexContribution {
  readonly contract: OptionsContract;
  /** Signed GEX contribution (puts already negated). */
  readonly gex: number;
  readonly unsignedUnitGex: number;
}
