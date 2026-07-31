import type { FetchLike } from "@/ingest/http";
import {
  MARKETDATA_APP_BASE_URL,
  MARKETDATA_APP_TIMEOUT_MS,
} from "./config";

export class MarketDataAppFetchError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "MarketDataAppFetchError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface FetchBoundedChainInput {
  readonly symbol: string;
  readonly expiration: string;
  readonly strikes: readonly number[];
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export interface FetchBoundedChainResult {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly creditsConsumed: number | null;
  readonly creditsRemaining: number | null;
  /** Sanitized request path (never includes Authorization). */
  readonly requestPath: string;
}

function readRateLimitHeader(
  headers: Headers,
  name: string,
): number | null {
  const raw = headers.get(name);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * One bounded options-chain GET. Token is sent only in Authorization header —
 * never embedded in the URL or returned in logs.
 */
export async function fetchBoundedMarketDataAppChain(
  input: FetchBoundedChainInput,
): Promise<FetchBoundedChainResult> {
  if (!input.token) {
    throw new MarketDataAppFetchError(
      "missing_token",
      "MARKETDATA_API_TOKEN (or MARKETDATA_APP_TOKEN) is required",
    );
  }
  if (input.strikes.length === 0) {
    throw new MarketDataAppFetchError("empty_strikes", "strike list is empty");
  }

  const baseUrl = input.baseUrl ?? MARKETDATA_APP_BASE_URL;
  const symbol = encodeURIComponent(input.symbol.toUpperCase());
  const strikeParam = input.strikes.join(",");
  const path =
    `/v1/options/chain/${symbol}/` +
    `?expiration=${encodeURIComponent(input.expiration)}` +
    `&strike=${encodeURIComponent(strikeParam)}`;
  const url = `${baseUrl}${path}`;

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? MARKETDATA_APP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (
      cause instanceof Error &&
      (cause.name === "AbortError" || /abort/i.test(msg))
    ) {
      throw new MarketDataAppFetchError(
        "timeout",
        `MarketData.app request timed out after ${timeoutMs}ms`,
      );
    }
    throw new MarketDataAppFetchError(
      "network",
      `MarketData.app network failure: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const creditsConsumed = readRateLimitHeader(
    response.headers,
    "x-api-ratelimit-consumed",
  );
  const creditsRemaining = readRateLimitHeader(
    response.headers,
    "x-api-ratelimit-remaining",
  );

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new MarketDataAppFetchError(
      "malformed",
      `MarketData.app response is not JSON: ${msg}`,
      response.status,
    );
  }

  return {
    httpStatus: response.status,
    body,
    creditsConsumed,
    creditsRemaining,
    requestPath: path,
  };
}
