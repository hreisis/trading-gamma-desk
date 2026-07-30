import type { FetchLike } from "@/ingest/http";
import type { RawMarketBar } from "./bars";
import {
  ALPACA_DATA_BASE_URL,
  MARKET_CONTEXT_MAX_RETRIES,
  MARKET_CONTEXT_TIMEOUT_MS,
  type MarketContextRuntimeConfig,
} from "./config";
import type {
  BarFetchRequest,
  BarFetchResult,
  MarketDataProvider,
} from "./provider";

export interface AlpacaProviderOptions {
  readonly config: MarketContextRuntimeConfig;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

interface AlpacaBarsResponse {
  readonly bars?: RawMarketBar[] | null;
  readonly next_page_token?: string | null;
  readonly symbol?: string;
}

function parseBarsPayload(json: unknown): {
  bars: RawMarketBar[];
  nextPageToken: string | null;
} {
  if (!json || typeof json !== "object") {
    throw new Error("Alpaca bars response is not an object");
  }
  const o = json as AlpacaBarsResponse;
  const bars = Array.isArray(o.bars) ? o.bars : [];
  const next =
    typeof o.next_page_token === "string" && o.next_page_token.length > 0
      ? o.next_page_token
      : null;
  return { bars, nextPageToken: next };
}

/**
 * Alpaca Historical Stock Bars adapter (1Min).
 * Auth via APCA_API_KEY_ID / APCA_API_SECRET_KEY — never logged.
 */
export function createAlpacaMarketDataProvider(
  options: AlpacaProviderOptions,
): MarketDataProvider {
  const config = options.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? ALPACA_DATA_BASE_URL;

  return {
    providerId: "alpaca",
    async fetchBars(request: BarFetchRequest): Promise<BarFetchResult> {
      if (!config.credentials) {
        return {
          ok: false,
          symbol: request.symbol,
          provider: "alpaca",
          feed: request.feed,
          error: "APCA_API_KEY_ID / APCA_API_SECRET_KEY missing — market context unavailable",
          unavailable: true,
        };
      }

      const collected: RawMarketBar[] = [];
      let pageToken: string | null = null;
      const maxAttempts = 1 + (config.maxRetries ?? MARKET_CONTEXT_MAX_RETRIES);
      let lastError = "unknown error";

      // Paginate until exhausted (cap pages to avoid runaway).
      for (let page = 0; page < 20; page += 1) {
        let pageOk = false;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const url = new URL(
            `${baseUrl}/v2/stocks/${encodeURIComponent(request.symbol)}/bars`,
          );
          url.searchParams.set("timeframe", request.timeframe);
          url.searchParams.set("start", request.start);
          url.searchParams.set("end", request.end);
          url.searchParams.set("feed", request.feed);
          url.searchParams.set("adjustment", "split");
          url.searchParams.set("limit", "10000");
          url.searchParams.set("sort", "asc");
          if (pageToken) url.searchParams.set("page_token", pageToken);

          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            config.timeoutMs ?? MARKET_CONTEXT_TIMEOUT_MS,
          );
          try {
            const response = await fetchImpl(url.toString(), {
              method: "GET",
              headers: {
                "APCA-API-KEY-ID": config.credentials.keyId,
                "APCA-API-SECRET-KEY": config.credentials.secretKey,
                Accept: "application/json",
              },
              signal: controller.signal,
            });
            const text = await response.text();
            if (response.status === 403 || response.status === 401) {
              return {
                ok: false,
                symbol: request.symbol,
                provider: "alpaca",
                feed: request.feed,
                error: `Alpaca auth/forbidden HTTP ${response.status}`,
                statusCode: response.status,
                unavailable: true,
              };
            }
            if (response.status === 429) {
              lastError = `Alpaca rate limited HTTP 429: ${text.slice(0, 120)}`;
              continue;
            }
            if (!response.ok) {
              lastError = `Alpaca HTTP ${response.status}: ${text.slice(0, 200)}`;
              continue;
            }
            let json: unknown;
            try {
              json = JSON.parse(text) as unknown;
            } catch {
              lastError = "Alpaca response is not JSON";
              continue;
            }
            const parsed = parseBarsPayload(json);
            collected.push(...parsed.bars);
            pageToken = parsed.nextPageToken;
            pageOk = true;
            break;
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              (error.name === "AbortError" || /timed out/i.test(error.message))
            ) {
              lastError = `Alpaca timed out after ${config.timeoutMs ?? MARKET_CONTEXT_TIMEOUT_MS}ms`;
            } else {
              lastError =
                error instanceof Error ? error.message : String(error);
            }
          } finally {
            clearTimeout(timer);
          }
        }
        if (!pageOk) {
          return {
            ok: false,
            symbol: request.symbol,
            provider: "alpaca",
            feed: request.feed,
            error: lastError,
          };
        }
        if (!pageToken) break;
      }

      return {
        ok: true,
        symbol: request.symbol,
        bars: collected,
        provider: "alpaca",
        feed: request.feed,
      };
    },
  };
}
