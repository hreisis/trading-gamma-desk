import { resolveAlpacaCredentials } from "@/catalyst/market-context/config";
import { resolveCatalystMarketFeed } from "@/catalyst/market-context/config";
import { isServerlessHost } from "@/desk/production-runtime";
import { SPY_BREADTH_CONFIG } from "../config";
import {
  latestCachedSession,
  readSymbolBarCache,
  writeSymbolBarCache,
} from "./cache";
import {
  mapAlpacaBar,
  mergeBarSeries,
  type AlpacaRawBar,
  type DailyBar,
  type SymbolBarSeries,
} from "./types";

export interface AlpacaPanelProvenance {
  readonly provider: "alpaca";
  readonly priceFeed: "iex" | "sip";
  readonly isConsolidated: boolean;
  readonly adjustment: "split";
  readonly requestedSymbols: number;
  readonly returnedSymbols: number;
  readonly coverage: number;
  readonly pages: number;
  readonly fetchedAt: string;
  readonly latestSessionDate: string | null;
  readonly failedSymbols: readonly string[];
}

export interface AlpacaPanelLoadResult {
  readonly seriesBySymbol: ReadonlyMap<string, SymbolBarSeries>;
  readonly provenance: AlpacaPanelProvenance;
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

function calendarDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export async function loadAlpacaDailyBarPanel(input: {
  readonly symbols: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly dataRoot?: string;
  readonly bootstrap?: boolean;
  readonly fetchImpl?: typeof fetch;
  /**
   * When false, a successful Alpaca fetch returns in-memory series only.
   * Defaults to false on Vercel/serverless hosts; true for local development.
   */
  readonly persistToFilesystem?: boolean;
}): Promise<AlpacaPanelLoadResult> {
  const env = input.env ?? process.env;
  const persistToFilesystem =
    input.persistToFilesystem ??
    !isServerlessHost(env as NodeJS.ProcessEnv);
  const credentials = resolveAlpacaCredentials(env);
  const feedRaw = resolveCatalystMarketFeed(env);
  const priceFeed: "iex" | "sip" = feedRaw === "sip" ? "sip" : "iex";
  const fetchedAt = new Date().toISOString();
  const dataRoot = input.dataRoot ?? "data";
  const fetchImpl = input.fetchImpl ?? fetch;
  const uniqueSymbols = [...new Set(input.symbols)];
  const seriesBySymbol = new Map<string, SymbolBarSeries>();
  const failedSymbols: string[] = [];
  let pages = 0;

  if (!credentials) {
    for (const symbol of uniqueSymbols) {
      const cached = readSymbolBarCache(dataRoot, symbol);
      if (cached && cached.bars.length > 0) {
        seriesBySymbol.set(symbol, cached);
      } else {
        failedSymbols.push(symbol);
      }
    }

    let latestSessionDate: string | null = null;
    for (const series of seriesBySymbol.values()) {
      const last = series.bars.at(-1)?.sessionDate ?? null;
      if (last && (!latestSessionDate || last > latestSessionDate)) {
        latestSessionDate = last;
      }
    }

    const returnedSymbols = uniqueSymbols.length - failedSymbols.length;
    return {
      seriesBySymbol,
      provenance: {
        provider: "alpaca",
        priceFeed,
        isConsolidated: priceFeed === "sip",
        adjustment: "split",
        requestedSymbols: uniqueSymbols.length,
        returnedSymbols,
        coverage:
          uniqueSymbols.length === 0
            ? 0
            : returnedSymbols / uniqueSymbols.length,
        pages: 0,
        fetchedAt,
        latestSessionDate,
        failedSymbols,
      },
    };
  }

  const baseUrl = (
    env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets"
  ).replace(/\/$/, "");

  for (
    let offset = 0;
    offset < uniqueSymbols.length;
    offset += SPY_BREADTH_CONFIG.alpacaBatchSize
  ) {
    const batch = uniqueSymbols.slice(
      offset,
      offset + SPY_BREADTH_CONFIG.alpacaBatchSize,
    );
    const incrementalStartBySymbol = new Map<string, string>();
    for (const symbol of batch) {
      const cached = readSymbolBarCache(dataRoot, symbol);
      if (input.bootstrap || !cached) {
        incrementalStartBySymbol.set(
          symbol,
          calendarDaysAgo(SPY_BREADTH_CONFIG.bootstrapCalendarDays).toISOString(),
        );
      } else {
        const latest = latestCachedSession(cached);
        incrementalStartBySymbol.set(
          symbol,
          calendarDaysAgo(SPY_BREADTH_CONFIG.incrementalTradingDays * 2).toISOString(),
        );
        seriesBySymbol.set(symbol, cached);
      }
    }
    const start = [...incrementalStartBySymbol.values()].sort()[0]!;
    const end = new Date().toISOString();
    let pageToken: string | null = null;
    do {
      pages += 1;
      const url = new URL(`${baseUrl}/v2/stocks/bars`);
      url.searchParams.set("symbols", batch.join(","));
      url.searchParams.set("timeframe", "1Day");
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
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
        throw new Error(`Alpaca bars HTTP ${response.status}: ${text.slice(0, 120)}`);
      }
      const json = (await response.json()) as unknown;
      const parsed = parseMultiBars(json);
      for (const symbol of batch) {
        const incoming = (parsed.bars[symbol] ?? []).map(mapAlpacaBar);
        const existing = seriesBySymbol.get(symbol)?.bars ?? [];
        const merged = mergeBarSeries(existing, incoming);
        const series: SymbolBarSeries = {
          symbol,
          bars: merged,
          updatedAt: fetchedAt,
        };
        seriesBySymbol.set(symbol, series);
        if (persistToFilesystem) {
          writeSymbolBarCache(dataRoot, series);
        }
      }
      pageToken = parsed.nextPageToken;
    } while (pageToken);
  }

  for (const symbol of uniqueSymbols) {
    if (!seriesBySymbol.has(symbol) || (seriesBySymbol.get(symbol)?.bars.length ?? 0) === 0) {
      failedSymbols.push(symbol);
    }
  }

  let latestSessionDate: string | null = null;
  for (const series of seriesBySymbol.values()) {
    const last = series.bars.at(-1)?.sessionDate ?? null;
    if (last && (!latestSessionDate || last > latestSessionDate)) {
      latestSessionDate = last;
    }
  }

  const returnedSymbols = uniqueSymbols.length - failedSymbols.length;
  return {
    seriesBySymbol,
    provenance: {
      provider: "alpaca",
      priceFeed,
      isConsolidated: priceFeed === "sip",
      adjustment: "split",
      requestedSymbols: uniqueSymbols.length,
      returnedSymbols,
      coverage:
        uniqueSymbols.length === 0
          ? 0
          : returnedSymbols / uniqueSymbols.length,
      pages,
      fetchedAt,
      latestSessionDate,
      failedSymbols,
    },
  };
}

export function countSessionBars(bars: readonly DailyBar[]): number {
  return bars.length;
}
