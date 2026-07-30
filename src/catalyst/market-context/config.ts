export const DEFAULT_CATALYST_MARKET_FEED = "sip";

export const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets";
export const ALPACA_BARS_PATH = "/v2/stocks";

export const MARKET_CONTEXT_TIMEOUT_MS = 25_000;
export const MARKET_CONTEXT_MAX_RETRIES = 1;
export const MARKET_CONTEXT_MAX_CONCURRENCY = 2;
export const MARKET_CONTEXT_MAX_PER_RUN = 12;
export const MARKET_CONTEXT_FEED_DAYS = 30;

/** Max lookback for baseline bar before the event (no distant substitutes). */
export const BASELINE_LOOKBACK_MS = 60 * 60 * 1000;

/** Max slack after a target window time to accept the next 1Min bar. */
export const WINDOW_SLACK_MS = 3 * 60 * 1000;

export function resolveAlpacaCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { keyId: string; secretKey: string } | null {
  const keyId = (env.APCA_API_KEY_ID ?? "").trim();
  const secretKey = (env.APCA_API_SECRET_KEY ?? "").trim();
  if (!keyId || !secretKey) return null;
  return { keyId, secretKey };
}

export function resolveCatalystMarketFeed(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const feed = (env.CATALYST_MARKET_FEED ?? "").trim().toLowerCase();
  return feed || DEFAULT_CATALYST_MARKET_FEED;
}

export interface MarketContextRuntimeConfig {
  readonly credentials: { keyId: string; secretKey: string } | null;
  readonly feed: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxConcurrency: number;
  readonly maxPerRun: number;
}

export function loadMarketContextConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<MarketContextRuntimeConfig> = {},
): MarketContextRuntimeConfig {
  return {
    credentials: overrides.credentials ?? resolveAlpacaCredentials(env),
    feed: overrides.feed ?? resolveCatalystMarketFeed(env),
    timeoutMs: overrides.timeoutMs ?? MARKET_CONTEXT_TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? MARKET_CONTEXT_MAX_RETRIES,
    maxConcurrency: overrides.maxConcurrency ?? MARKET_CONTEXT_MAX_CONCURRENCY,
    maxPerRun: overrides.maxPerRun ?? MARKET_CONTEXT_MAX_PER_RUN,
  };
}
