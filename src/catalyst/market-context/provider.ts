import type { RawMarketBar } from "./bars";

export interface BarFetchRequest {
  readonly symbol: string;
  readonly start: string;
  readonly end: string;
  readonly timeframe: "1Min";
  readonly feed: string;
}

export type BarFetchResult =
  | {
      readonly ok: true;
      readonly symbol: string;
      readonly bars: readonly RawMarketBar[];
      readonly provider: string;
      readonly feed: string;
    }
  | {
      readonly ok: false;
      readonly symbol: string;
      readonly provider: string;
      readonly feed: string;
      readonly error: string;
      readonly statusCode?: number;
      readonly unavailable?: boolean;
    };

export interface MarketDataProvider {
  readonly providerId: string;
  fetchBars(request: BarFetchRequest): Promise<BarFetchResult>;
}
