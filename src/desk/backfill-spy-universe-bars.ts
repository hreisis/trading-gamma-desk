/**
 * Fill missing SPY-constituent daily bars in data/bars/spy-universe.
 * Uses the existing Alpaca multi-symbol 1Day endpoint. Does not change
 * live breadth production, Risk scoring, or cache format.
 */
import {
  ALPACA_DATA_BASE_URL,
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
} from "@/catalyst/market-context/config";
import { defaultSessionCalendar } from "@/macro/calendar";
import {
  readSymbolBarCache,
  writeSymbolBarCache,
} from "@/desk/breadth/bars/cache";
import {
  mapAlpacaBar,
  type AlpacaRawBar,
  type DailyBar,
  type SymbolBarSeries,
} from "@/desk/breadth/bars/types";
import { SPY_BREADTH_CONFIG } from "@/desk/breadth/config";
import { loadPersistedSpyUniverse } from "@/desk/breadth/universe/persist";

export const SPY_UNIVERSE_BAR_BACKFILL_START = "2026-05-15";
export const SPY_UNIVERSE_BAR_BACKFILL_END = "2026-08-24";

export interface SpyUniverseBarBackfillResult {
  readonly startDate: string;
  readonly endDate: string;
  readonly expectedSessions: number;
  readonly holdingsAsOf: string | null;
  readonly symbolCount: number;
  readonly alreadyComplete: number;
  readonly symbolsFetched: number;
  readonly symbolsFilled: readonly string[];
  readonly apiRequests: number;
  readonly batches: number;
  readonly remainingMissing: readonly {
    readonly symbol: string;
    readonly missingSessions: number;
  }[];
}

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

export function tradingSessionsInRange(
  startDate: string,
  endDate: string,
): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    if (defaultSessionCalendar.isSession(cursor)) dates.push(cursor);
    cursor = addOneDay(cursor);
  }
  return dates;
}

function isValidDailyBar(bar: DailyBar): boolean {
  return (
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    bar.close > 0 &&
    Number.isFinite(bar.volume) &&
    bar.volume >= 0
  );
}

function mergeKeepExistingValid(
  existing: readonly DailyBar[],
  incoming: readonly DailyBar[],
): DailyBar[] {
  const byDate = new Map<string, DailyBar>();
  for (const bar of incoming) {
    if (isValidDailyBar(bar)) byDate.set(bar.sessionDate, bar);
  }
  for (const bar of existing) {
    if (isValidDailyBar(bar)) byDate.set(bar.sessionDate, bar);
  }
  return [...byDate.values()].sort((left, right) =>
    left.sessionDate.localeCompare(right.sessionDate),
  );
}

function parseMultiBars(json: unknown): {
  bars: Record<string, AlpacaRawBar[]>;
  nextPageToken: string | null;
} {
  if (!json || typeof json !== "object") return { bars: {}, nextPageToken: null };
  const o = json as {
    bars?: Record<string, AlpacaRawBar[]>;
    next_page_token?: string | null;
  };
  return {
    bars: o.bars ?? {},
    nextPageToken:
      typeof o.next_page_token === "string" && o.next_page_token.length > 0
        ? o.next_page_token
        : null,
  };
}

function missingSessionsForSymbol(
  series: SymbolBarSeries | null,
  expected: readonly string[],
): string[] {
  const have = new Set(
    (series?.bars ?? [])
      .filter(isValidDailyBar)
      .filter((bar) => bar.sessionDate >= expected[0]! && bar.sessionDate <= expected.at(-1)!)
      .map((bar) => bar.sessionDate),
  );
  return expected.filter((date) => !have.has(date));
}

export async function backfillSpyUniverseDailyBars(options: {
  readonly dataRoot: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}): Promise<SpyUniverseBarBackfillResult> {
  const env = options.env ?? process.env;
  const startDate = options.startDate ?? SPY_UNIVERSE_BAR_BACKFILL_START;
  const endDate = options.endDate ?? SPY_UNIVERSE_BAR_BACKFILL_END;
  const expected = tradingSessionsInRange(startDate, endDate);
  const universe = loadPersistedSpyUniverse(options.dataRoot);
  if (!universe) {
    throw new Error(`No persisted SPY holdings list under ${options.dataRoot}/universes/SPY`);
  }
  const symbols = universe.constituents.map((row) => row.symbol);
  const credentials = resolveAlpacaCredentials(env);
  if (!credentials) {
    throw new Error("Alpaca credentials missing (APCA_API_KEY_ID / APCA_API_SECRET_KEY).");
  }

  const needFetch: string[] = [];
  let alreadyComplete = 0;
  for (const symbol of symbols) {
    const cached = readSymbolBarCache(options.dataRoot, symbol);
    if (missingSessionsForSymbol(cached, expected).length === 0) {
      alreadyComplete += 1;
    } else {
      needFetch.push(symbol);
    }
  }

  const feedRaw = resolveCatalystMarketFeed(env);
  const priceFeed: "iex" | "sip" = feedRaw === "sip" ? "sip" : "iex";
  const baseUrl = (env.ALPACA_DATA_BASE_URL ?? ALPACA_DATA_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = new Date().toISOString();
  const startIso = `${startDate}T00:00:00-04:00`;
  const endExclusive = addOneDay(endDate);
  const endIso = `${endExclusive}T00:00:00-04:00`;

  let apiRequests = 0;
  let batches = 0;
  const filled = new Set<string>();
  const incomingBySymbol = new Map<string, DailyBar[]>();

  for (let offset = 0; offset < needFetch.length; offset += SPY_BREADTH_CONFIG.alpacaBatchSize) {
    const batch = needFetch.slice(offset, offset + SPY_BREADTH_CONFIG.alpacaBatchSize);
    batches += 1;
    let pageToken: string | null = null;
    do {
      apiRequests += 1;
      const url = new URL(`${baseUrl}/v2/stocks/bars`);
      url.searchParams.set("symbols", batch.join(","));
      url.searchParams.set("timeframe", "1Day");
      url.searchParams.set("start", startIso);
      url.searchParams.set("end", endIso);
      url.searchParams.set("feed", priceFeed);
      url.searchParams.set("adjustment", SPY_BREADTH_CONFIG.barAdjustment);
      url.searchParams.set("limit", "10000");
      url.searchParams.set("sort", "asc");
      if (pageToken) url.searchParams.set("page_token", pageToken);

      const response = await fetchImpl(url.toString(), {
        headers: {
          "APCA-API-KEY-ID": credentials.keyId,
          "APCA-API-SECRET-KEY": credentials.secretKey,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Alpaca bars HTTP ${response.status}: ${text.slice(0, 180)}`);
      }
      const parsed = parseMultiBars((await response.json()) as unknown);
      for (const symbol of batch) {
        const incoming = (parsed.bars[symbol] ?? []).map(mapAlpacaBar);
        const prior = incomingBySymbol.get(symbol) ?? [];
        incomingBySymbol.set(symbol, [...prior, ...incoming]);
      }
      pageToken = parsed.nextPageToken;
    } while (pageToken);
  }

  for (const symbol of needFetch) {
    const existing = readSymbolBarCache(options.dataRoot, symbol);
    const incoming = incomingBySymbol.get(symbol) ?? [];
    const merged = mergeKeepExistingValid(existing?.bars ?? [], incoming);
    const before = new Set(
      (existing?.bars ?? []).filter(isValidDailyBar).map((bar) => bar.sessionDate),
    );
    const added = merged.filter((bar) => !before.has(bar.sessionDate));
    if (added.length > 0) {
      const series: SymbolBarSeries = {
        symbol,
        bars: merged,
        updatedAt: fetchedAt,
      };
      writeSymbolBarCache(options.dataRoot, series);
      filled.add(symbol);
    }
  }

  const remainingMissing: { symbol: string; missingSessions: number }[] = [];
  for (const symbol of symbols) {
    const cached = readSymbolBarCache(options.dataRoot, symbol);
    const missing = missingSessionsForSymbol(cached, expected);
    if (missing.length > 0) {
      remainingMissing.push({ symbol, missingSessions: missing.length });
    }
  }
  remainingMissing.sort((left, right) => left.symbol.localeCompare(right.symbol));

  return {
    startDate,
    endDate,
    expectedSessions: expected.length,
    holdingsAsOf: universe.asOf,
    symbolCount: symbols.length,
    alreadyComplete,
    symbolsFetched: needFetch.length,
    symbolsFilled: [...filled].sort((left, right) => left.localeCompare(right)),
    apiRequests,
    batches,
    remainingMissing,
  };
}
