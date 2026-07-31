/**
 * MarketData.app options chain response — parallel arrays (one index per contract).
 * Confirmed via live connectivity test (HTTP 203, s="ok").
 */
export const MARKETDATA_APP_CHAIN_ARRAY_FIELDS = [
  "optionSymbol",
  "underlying",
  "side",
  "strike",
  "expiration",
  "openInterest",
  "volume",
  "gamma",
  "iv",
  "underlyingPrice",
  "updated",
] as const;

export type MarketDataAppChainArrayField =
  (typeof MARKETDATA_APP_CHAIN_ARRAY_FIELDS)[number];

export interface MarketDataAppChainResponse {
  readonly s: string;
  readonly errmsg?: string;
  readonly optionSymbol: readonly string[];
  readonly underlying: readonly string[];
  readonly side: readonly string[];
  readonly strike: readonly number[];
  readonly expiration: readonly number[];
  readonly openInterest: readonly (number | null)[];
  readonly volume: readonly (number | null)[];
  readonly gamma: readonly (number | null)[];
  readonly iv: readonly (number | null)[];
  readonly underlyingPrice: readonly number[];
  readonly updated: readonly number[];
}
