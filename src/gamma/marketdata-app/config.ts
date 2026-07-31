export const MARKETDATA_APP_BASE_URL = "https://api.marketdata.app";
export const MARKETDATA_APP_TIMEOUT_MS = 60_000;

/** Default hard cap on estimated contracts (strikeCount × 2). */
export const DEFAULT_MAX_EXPECTED_CONTRACTS = 250;

/**
 * Token from env. Prefer MARKETDATA_API_TOKEN (project .env convention);
 * MARKETDATA_APP_TOKEN accepted as alias. Never log the value.
 */
export function resolveMarketDataApiToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw =
    env.MARKETDATA_API_TOKEN ?? env.MARKETDATA_APP_TOKEN ?? "";
  const token = raw.trim().replace(/^["']|["']$/g, "");
  return token.length > 0 ? token : null;
}
