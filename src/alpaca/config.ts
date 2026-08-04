import {
  ALPACA_DATA_BASE_URL,
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
} from "@/catalyst/market-context/config";

export { ALPACA_DATA_BASE_URL, resolveAlpacaCredentials };

/** Core portfolio symbols always requested when Alpaca is configured. */
export const DEFAULT_ALPACA_SYMBOLS = ["SPY", "QQQ", "BTC/USD"] as const;

export const ALPACA_CLIENT_TIMEOUT_MS = 15_000;
export const ALPACA_STALE_QUOTE_MS = 24 * 60 * 60 * 1000;

export interface AlpacaClientConfig {
  readonly credentials: { keyId: string; secretKey: string } | null;
  readonly baseUrl: string;
  readonly feed: string;
  readonly timeoutMs: number;
  readonly staleQuoteMs: number;
}

export function resolveAlpacaBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = (env.ALPACA_DATA_BASE_URL ?? "").trim();
  return override || ALPACA_DATA_BASE_URL;
}

export function resolveAlpacaWatchlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = (env.ALPACA_WATCHLIST ?? "").trim();
  const extra = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const merged = [...DEFAULT_ALPACA_SYMBOLS, ...extra];
  return [...new Set(merged)];
}

export function isCryptoSymbol(symbol: string): boolean {
  return symbol.includes("/");
}

export function loadAlpacaClientConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<AlpacaClientConfig> = {},
): AlpacaClientConfig {
  return {
    credentials: overrides.credentials ?? resolveAlpacaCredentials(env),
    baseUrl: overrides.baseUrl ?? resolveAlpacaBaseUrl(env),
    feed: overrides.feed ?? resolveCatalystMarketFeed(env),
    timeoutMs: overrides.timeoutMs ?? ALPACA_CLIENT_TIMEOUT_MS,
    staleQuoteMs: overrides.staleQuoteMs ?? ALPACA_STALE_QUOTE_MS,
  };
}
