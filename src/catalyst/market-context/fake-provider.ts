import type { RawMarketBar } from "./bars";
import type {
  BarFetchRequest,
  BarFetchResult,
  MarketDataProvider,
} from "./provider";

export type FakeMarketProviderMode =
  | "ok"
  | "empty"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "malformed"
  | "provider_error";

export function createFakeMarketDataProvider(
  mode: FakeMarketProviderMode = "ok",
  barsBySymbol: ReadonlyMap<string, readonly RawMarketBar[]> = new Map(),
): MarketDataProvider {
  return {
    providerId: "fake",
    async fetchBars(request: BarFetchRequest): Promise<BarFetchResult> {
      if (mode === "timeout") {
        return {
          ok: false,
          symbol: request.symbol,
          provider: "fake",
          feed: request.feed,
          error: "Alpaca timed out after 1ms",
        };
      }
      if (mode === "auth") {
        return {
          ok: false,
          symbol: request.symbol,
          provider: "fake",
          feed: request.feed,
          error: "Alpaca auth/forbidden HTTP 403",
          statusCode: 403,
          unavailable: true,
        };
      }
      if (mode === "rate_limit") {
        return {
          ok: false,
          symbol: request.symbol,
          provider: "fake",
          feed: request.feed,
          error: "Alpaca rate limited HTTP 429",
          statusCode: 429,
        };
      }
      if (mode === "provider_error") {
        return {
          ok: false,
          symbol: request.symbol,
          provider: "fake",
          feed: request.feed,
          error: "fake provider failure",
        };
      }
      if (mode === "malformed") {
        return {
          ok: true,
          symbol: request.symbol,
          bars: [{ t: "not-a-date", o: 1, h: 1, l: 1, c: 1 }],
          provider: "fake",
          feed: request.feed,
        };
      }
      if (mode === "empty") {
        return {
          ok: true,
          symbol: request.symbol,
          bars: [],
          provider: "fake",
          feed: request.feed,
        };
      }
      return {
        ok: true,
        symbol: request.symbol,
        bars: barsBySymbol.get(request.symbol) ?? [],
        provider: "fake",
        feed: request.feed,
      };
    },
  };
}

/** Build evenly spaced 1Min bars for tests. */
export function synthesizeBars(options: {
  readonly startMs: number;
  readonly count: number;
  readonly startPrice: number;
  readonly step?: number;
}): RawMarketBar[] {
  const step = options.step ?? 0.01;
  const out: RawMarketBar[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const px = options.startPrice + i * step;
    const t = new Date(options.startMs + i * 60_000).toISOString();
    out.push({ t, o: px, h: px + 0.05, l: px - 0.05, c: px, v: 1000 });
  }
  return out;
}
