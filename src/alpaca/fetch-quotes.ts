import type { AlpacaMarketQuote } from "@/contracts/alpaca-market";
import type { AlpacaClient } from "./client";
import { isCryptoSymbol, type AlpacaClientConfig } from "./config";

interface AlpacaBarLike {
  readonly c?: number;
  readonly t?: string;
}

interface AlpacaTradeLike {
  readonly p?: number;
  readonly t?: string;
}

interface AlpacaSnapshot {
  readonly dailyBar?: AlpacaBarLike | null;
  readonly prevDailyBar?: AlpacaBarLike | null;
  readonly latestTrade?: AlpacaTradeLike | null;
  readonly minuteBar?: AlpacaBarLike | null;
}

type AlpacaSnapshotsResponse = Record<string, AlpacaSnapshot | undefined>;

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pickLatestPrice(snapshot: AlpacaSnapshot): {
  price: number | null;
  timestamp: string | null;
} {
  const trade = snapshot.latestTrade;
  if (typeof trade?.p === "number" && Number.isFinite(trade.p)) {
    return { price: trade.p, timestamp: trade.t ?? null };
  }
  const minute = snapshot.minuteBar;
  if (typeof minute?.c === "number" && Number.isFinite(minute.c)) {
    return { price: minute.c, timestamp: minute.t ?? null };
  }
  const daily = snapshot.dailyBar;
  if (typeof daily?.c === "number" && Number.isFinite(daily.c)) {
    return { price: daily.c, timestamp: daily.t ?? null };
  }
  return { price: null, timestamp: null };
}

function computeDailyChangePct(snapshot: AlpacaSnapshot): number | null {
  const prevClose = snapshot.prevDailyBar?.c;
  const { price } = pickLatestPrice(snapshot);
  if (
    typeof prevClose !== "number" ||
    !Number.isFinite(prevClose) ||
    prevClose === 0 ||
    price === null
  ) {
    return null;
  }
  return ((price - prevClose) / prevClose) * 100;
}

function classifyQuoteFreshness(
  timestamp: string | null,
  nowMs: number,
  staleQuoteMs: number,
): AlpacaMarketQuote["status"] {
  const tsMs = timestamp ? parseTimestampMs(timestamp) : null;
  if (tsMs === null) return "unavailable";
  if (nowMs - tsMs > staleQuoteMs) return "stale";
  return "available";
}

function quoteFromSnapshot(
  symbol: string,
  snapshot: AlpacaSnapshot | undefined,
  nowMs: number,
  staleQuoteMs: number,
): AlpacaMarketQuote {
  if (!snapshot) {
    return {
      symbol,
      latestPrice: null,
      dailyChangePct: null,
      timestamp: null,
      source: "alpaca",
      status: "unavailable",
      error: "No snapshot returned for symbol",
    };
  }

  const { price, timestamp } = pickLatestPrice(snapshot);
  const dailyChangePct = computeDailyChangePct(snapshot);
  const status = classifyQuoteFreshness(timestamp, nowMs, staleQuoteMs);

  if (price === null) {
    return {
      symbol,
      latestPrice: null,
      dailyChangePct,
      timestamp,
      source: "alpaca",
      status: "unavailable",
      error: "Snapshot missing a usable price",
    };
  }

  return {
    symbol,
    latestPrice: price,
    dailyChangePct,
    timestamp,
    source: "alpaca",
    status,
  };
}

async function fetchStockSnapshots(
  client: AlpacaClient,
  config: AlpacaClientConfig,
  symbols: readonly string[],
): Promise<AlpacaSnapshotsResponse> {
  if (symbols.length === 0) return {};
  return client.getJson<AlpacaSnapshotsResponse>("/v2/stocks/snapshots", {
    symbols: symbols.join(","),
    feed: config.feed,
  });
}

async function fetchCryptoSnapshots(
  client: AlpacaClient,
  symbols: readonly string[],
): Promise<AlpacaSnapshotsResponse> {
  if (symbols.length === 0) return {};
  const raw = await client.getJson<
    AlpacaSnapshotsResponse | { snapshots?: AlpacaSnapshotsResponse }
  >("/v1beta3/crypto/us/snapshots", {
    symbols: symbols.join(","),
  });
  if (
    raw &&
    typeof raw === "object" &&
    "snapshots" in raw &&
    raw.snapshots &&
    typeof raw.snapshots === "object"
  ) {
    return raw.snapshots as AlpacaSnapshotsResponse;
  }
  return raw as AlpacaSnapshotsResponse;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function fetchAlpacaMarketQuotes(input: {
  readonly client: AlpacaClient;
  readonly config: AlpacaClientConfig;
  readonly symbols: readonly string[];
  readonly now?: Date;
}): Promise<AlpacaMarketQuote[]> {
  const nowMs = (input.now ?? new Date()).getTime();
  const stocks = input.symbols.filter((s) => !isCryptoSymbol(s));
  const crypto = input.symbols.filter((s) => isCryptoSymbol(s));

  let stockPayload: AlpacaSnapshotsResponse = {};
  let cryptoPayload: AlpacaSnapshotsResponse = {};
  let stockError: string | null = null;
  let cryptoError: string | null = null;

  if (stocks.length > 0) {
    try {
      stockPayload = await fetchStockSnapshots(input.client, input.config, stocks);
    } catch (error: unknown) {
      stockError = errorMessage(error);
    }
  }

  if (crypto.length > 0) {
    try {
      cryptoPayload = await fetchCryptoSnapshots(input.client, crypto);
    } catch (error: unknown) {
      cryptoError = errorMessage(error);
    }
  }

  const merged: AlpacaSnapshotsResponse = {
    ...stockPayload,
    ...cryptoPayload,
  };

  return input.symbols.map((symbol) => {
    const quote = quoteFromSnapshot(
      symbol,
      merged[symbol],
      nowMs,
      input.config.staleQuoteMs,
    );
    if (quote.status !== "unavailable") return quote;
    const scopedError = isCryptoSymbol(symbol) ? cryptoError : stockError;
    if (!scopedError) return quote;
    return {
      ...quote,
      error: scopedError,
    };
  });
}
