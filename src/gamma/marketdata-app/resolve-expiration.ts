import type { FetchLike } from "@/ingest/http";
import { fetchMarketDataAppExpirations, MarketDataAppFetchError } from "./fetch";
import {
  isMarketDataCreditLimitExhausted,
  markMarketDataCreditsExhausted,
} from "./credits";
import { defaultBoundedExpiration } from "./time";

export type BoundedGammaExpirationSource = "env" | "discovered" | "default";

export function pickNearestExpirationOnOrAfter(
  sessionDate: string,
  expirations: readonly string[],
): string | null {
  const sessionMs = Date.parse(`${sessionDate}T12:00:00-04:00`);
  if (!Number.isFinite(sessionMs)) return null;

  const sorted = [...expirations].sort();
  for (const expiration of sorted) {
    const expMs = Date.parse(`${expiration}T12:00:00-04:00`);
    if (Number.isFinite(expMs) && expMs >= sessionMs) {
      return expiration;
    }
  }
  return sorted[sorted.length - 1] ?? null;
}

export async function resolveBoundedGammaExpiration(input: {
  readonly symbol: string;
  readonly sessionDate: string;
  readonly configuredExpiration?: string | null;
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}): Promise<{
  readonly expiration: string;
  readonly source: BoundedGammaExpirationSource;
}> {
  const configured = (input.configuredExpiration ?? "").trim();
  if (configured) {
    return { expiration: configured, source: "env" };
  }

  try {
    const result = await fetchMarketDataAppExpirations({
      symbol: input.symbol,
      token: input.token,
      fetchImpl: input.fetchImpl,
      baseUrl: input.baseUrl,
    });
    const picked = pickNearestExpirationOnOrAfter(
      input.sessionDate,
      result.expirations,
    );
    if (picked) {
      return { expiration: picked, source: "discovered" };
    }
  } catch (error: unknown) {
    if (
      error instanceof MarketDataAppFetchError &&
      isMarketDataCreditLimitExhausted({
        httpStatus: error.httpStatus,
        message: error.message,
      })
    ) {
      markMarketDataCreditsExhausted();
      throw error;
    }
    // Fall through to deterministic default for other errors.
  }

  return {
    expiration: defaultBoundedExpiration(input.sessionDate),
    source: "default",
  };
}
