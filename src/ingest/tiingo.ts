import { ASSET_REGISTRY, type MacroSymbol } from "@/contracts";
import { defaultSessionCalendar } from "@/macro";
import { sessionDateFromIsoPrefix } from "./dates";
import { fetchValidated, type FetchLike } from "./http";
import { assertJsonArray } from "./validate";
import { IngestError, type RawBar, type SymbolSeries } from "./types";

export const TIINGO_ETF_TICKERS: Readonly<
  Record<"GOLD" | "COPPER" | "OIL" | "USD", string>
> = {
  GOLD: "gld",
  COPPER: "cper",
  OIL: "uso",
  USD: "uup",
};

const EXPECTED_ETF_FIELDS = [
  "date",
  "close",
  "adjClose",
  "divCash",
  "splitFactor",
] as const;

function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TIINGO_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
}

function etfUrl(ticker: string, startDate: string, endDate: string): string {
  return (
    `https://api.tiingo.com/tiingo/daily/${ticker}/prices` +
    `?startDate=${startDate}&endDate=${endDate}`
  );
}

function cryptoUrl(startDate: string, endDate: string): string {
  return (
    "https://api.tiingo.com/tiingo/crypto/prices" +
    `?tickers=btcusd&resampleFreq=1day&startDate=${startDate}&endDate=${endDate}`
  );
}

/** Parse Tiingo daily ETF rows; prefer adjClose (policy, not a measurement). */
export function parseTiingoEtfRows(
  rows: readonly Record<string, unknown>[],
  source: string,
): RawBar[] {
  if (rows.length === 0) {
    throw new IngestError("payload_shape", `${source}: empty row set`);
  }
  const sample = rows[0]!;
  for (const field of EXPECTED_ETF_FIELDS) {
    if (!(field in sample)) {
      throw new IngestError(
        "payload_shape",
        `${source}: missing field ${field}; got ${Object.keys(sample).join(",")}`,
      );
    }
  }

  const bars: RawBar[] = [];
  for (const row of rows) {
    const rawDate = String(row.date ?? "");
    const adjClose = Number(row.adjClose);
    if (!rawDate || !Number.isFinite(adjClose) || adjClose <= 0) continue;
    bars.push({
      sessionDate: sessionDateFromIsoPrefix(rawDate),
      value: adjClose,
      source,
      rawDate,
    });
  }
  return bars.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1));
}

/**
 * Parse Tiingo crypto daily bars and snap onto the equity session calendar.
 * Drops the in-progress UTC day and any weekend/holiday bars.
 */
export function parseTiingoBtcRows(
  envelope: unknown,
  options: {
    readonly todayUtc: string;
    readonly isSession?: (date: string) => boolean;
  },
): RawBar[] {
  if (!Array.isArray(envelope) || envelope.length === 0) {
    throw new IngestError("payload_shape", "Tiingo crypto: empty envelope");
  }
  const series = envelope[0] as { priceData?: unknown };
  const priceData = series.priceData;
  if (!Array.isArray(priceData) || priceData.length === 0) {
    throw new IngestError("payload_shape", "Tiingo crypto: empty priceData");
  }

  const isSession = options.isSession ?? defaultSessionCalendar.isSession;
  const bars: RawBar[] = [];

  for (const row of priceData as Record<string, unknown>[]) {
    const rawDate = String(row.date ?? "");
    const close = Number(row.close);
    if (!rawDate || !Number.isFinite(close) || close <= 0) continue;
    const sessionDate = sessionDateFromIsoPrefix(rawDate);
    // In-progress UTC day and non-equity sessions are dropped, not bridged.
    if (sessionDate >= options.todayUtc) continue;
    if (!isSession(sessionDate)) continue;
    bars.push({
      sessionDate,
      value: close,
      source: "tiingo/crypto/btcusd",
      rawDate,
    });
  }

  return bars.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1));
}

export async function fetchTiingoEtf(
  symbol: keyof typeof TIINGO_ETF_TICKERS,
  startDate: string,
  endDate: string,
  options: {
    readonly token?: string;
    readonly fetchImpl?: FetchLike;
  } = {},
): Promise<SymbolSeries> {
  const token = options.token ?? tokenFromEnv();
  if (!token) {
    throw new IngestError("auth", "TIINGO_TOKEN is empty");
  }

  const ticker = TIINGO_ETF_TICKERS[symbol];
  const definition = ASSET_REGISTRY[symbol as MacroSymbol];
  const validated = await fetchValidated(
    etfUrl(ticker, startDate, endDate),
    {
      label: `Tiingo ${ticker}`,
      contentTypeIncludes: "application/json",
    },
    { headers: authHeaders(token), fetchImpl: options.fetchImpl },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(validated.body);
  } catch {
    throw new IngestError("payload_shape", `Tiingo ${ticker}: body is not JSON`);
  }
  assertJsonArray(`Tiingo ${ticker}`, parsed, 20);

  const bars = parseTiingoEtfRows(
    parsed as Record<string, unknown>[],
    `tiingo/daily/${ticker}`,
  );

  return {
    symbol: symbol as MacroSymbol,
    instrument: definition.instrument,
    isProxy: definition.isProxy,
    source: `tiingo/daily/${ticker}`,
    bars,
  };
}

export async function fetchTiingoBtc(
  startDate: string,
  endDate: string,
  options: {
    readonly token?: string;
    readonly fetchImpl?: FetchLike;
    readonly todayUtc?: string;
  } = {},
): Promise<SymbolSeries> {
  const token = options.token ?? tokenFromEnv();
  if (!token) {
    throw new IngestError("auth", "TIINGO_TOKEN is empty");
  }

  const todayUtc = options.todayUtc ?? new Date().toISOString().slice(0, 10);
  const validated = await fetchValidated(
    cryptoUrl(startDate, endDate),
    {
      label: "Tiingo btcusd",
      contentTypeIncludes: "application/json",
    },
    { headers: authHeaders(token), fetchImpl: options.fetchImpl },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(validated.body);
  } catch {
    throw new IngestError("payload_shape", "Tiingo btcusd: body is not JSON");
  }

  const bars = parseTiingoBtcRows(parsed, { todayUtc });
  if (bars.length < 20) {
    throw new IngestError(
      "row_count",
      `Tiingo btcusd produced only ${bars.length} equity-session bars`,
    );
  }

  return {
    symbol: "BTC",
    instrument: ASSET_REGISTRY.BTC.instrument,
    isProxy: false,
    source: "tiingo/crypto/btcusd",
    bars,
  };
}
