import type { FetchLike } from "@/ingest/http";
import {
  isMarketDataCreditLimitExhausted,
  markMarketDataCreditsExhausted,
} from "./credits";
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
  readonly date?: string;
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

export interface FetchExpirationsInput {
  readonly symbol: string;
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export interface FetchExpirationsResult {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly expirations: readonly string[];
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

async function fetchMarketDataAppJson(input: {
  readonly path: string;
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}): Promise<{
  readonly httpStatus: number;
  readonly body: unknown;
  readonly requestPath: string;
  readonly creditsConsumed: number | null;
  readonly creditsRemaining: number | null;
}> {
  if (!input.token) {
    throw new MarketDataAppFetchError(
      "missing_token",
      "MARKETDATA_API_TOKEN (or MARKETDATA_APP_TOKEN) is required",
    );
  }

  const baseUrl = input.baseUrl ?? MARKETDATA_APP_BASE_URL;
  const url = `${baseUrl}${input.path}`;
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
    requestPath: input.path,
    creditsConsumed: readRateLimitHeader(
      response.headers,
      "x-api-ratelimit-consumed",
    ),
    creditsRemaining: readRateLimitHeader(
      response.headers,
      "x-api-ratelimit-remaining",
    ),
  };
}

function readVendorExpirations(body: unknown): readonly string[] {
  if (!body || typeof body !== "object") {
    throw new MarketDataAppFetchError(
      "vendor_status",
      "MarketData.app expirations body must be an object",
    );
  }
  const record = body as { s?: unknown; expirations?: unknown; errmsg?: unknown };
  if (record.s === "no_data") {
    throw new MarketDataAppFetchError("no_data", "MarketData.app s=no_data");
  }
  if (record.s === "error") {
    const detail =
      typeof record.errmsg === "string" && record.errmsg.length > 0
        ? record.errmsg
        : "vendor error";
    throw new MarketDataAppFetchError("vendor_status", detail);
  }
  if (record.s !== "ok" || !Array.isArray(record.expirations)) {
    throw new MarketDataAppFetchError(
      "vendor_status",
      `MarketData.app unexpected expirations response s=${String(record.s)}`,
    );
  }
  return record.expirations.filter(
    (value): value is string =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
  );
}

/** List available option expirations for bounded-gamma expiry discovery. */
export async function fetchMarketDataAppExpirations(
  input: FetchExpirationsInput,
): Promise<FetchExpirationsResult> {
  const symbol = encodeURIComponent(input.symbol.toUpperCase());
  const path = `/v1/options/expirations/${symbol}/`;
  const result = await fetchMarketDataAppJson({
    path,
    token: input.token,
    fetchImpl: input.fetchImpl,
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
  });
  if (isMarketDataCreditLimitExhausted({
    httpStatus: result.httpStatus,
    body: result.body,
  })) {
    markMarketDataCreditsExhausted();
    throw new MarketDataAppFetchError(
      "credit_limit",
      `MarketData.app HTTP ${result.httpStatus}: daily API credit limit exhausted`,
      result.httpStatus,
    );
  }
  if (result.httpStatus === 401 || result.httpStatus === 403) {
    throw new MarketDataAppFetchError(
      "auth",
      `MarketData.app HTTP ${result.httpStatus}: check MARKETDATA_API_TOKEN`,
      result.httpStatus,
    );
  }
  return {
    httpStatus: result.httpStatus,
    body: result.body,
    expirations: readVendorExpirations(result.body),
    requestPath: path,
  };
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

  const symbol = encodeURIComponent(input.symbol.toUpperCase());
  const strikeParam = input.strikes.join(",");
  const dateParam = input.date
    ? `&date=${encodeURIComponent(input.date)}`
    : "";
  const path =
    `/v1/options/chain/${symbol}/` +
    `?expiration=${encodeURIComponent(input.expiration)}` +
    `&strike=${encodeURIComponent(strikeParam)}` +
    dateParam;

  const result = await fetchMarketDataAppJson({
    path,
    token: input.token,
    fetchImpl: input.fetchImpl,
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
  });

  return {
    httpStatus: result.httpStatus,
    body: result.body,
    creditsConsumed: result.creditsConsumed,
    creditsRemaining: result.creditsRemaining,
    requestPath: path,
  };
}
