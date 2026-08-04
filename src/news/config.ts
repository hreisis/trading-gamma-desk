import type { MarketNewsTopic } from "@/contracts/market-news";
import {
  DEFAULT_ALPACA_SYMBOLS,
  loadAlpacaClientConfig,
  resolveAlpacaWatchlist,
  type AlpacaClientConfig,
} from "@/alpaca/config";

export {
  loadAlpacaClientConfig,
  type AlpacaClientConfig,
} from "@/alpaca/config";

export const MARKET_NEWS_MACRO_LIMIT = 15;
export const MARKET_NEWS_SYMBOLS_LIMIT = 50;
/** Headlines older than this are labelled stale (not hidden). */
export const MARKET_NEWS_STALE_MS = 48 * 60 * 60 * 1000;

const CORE_INDEX_SYMBOLS = new Set(["SPY", "QQQ"]);
const CORE_CRYPTO_SYMBOLS = new Set(["BTC/USD"]);

export function toAlpacaNewsSymbol(symbol: string): string {
  if (symbol.includes("/")) {
    return symbol.replace("/", "");
  }
  return symbol.toUpperCase();
}

export function fromAlpacaNewsSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (/^[A-Z]{2,5}USD$/.test(upper) && !upper.includes("/")) {
    return `${upper.slice(0, -3)}/USD`;
  }
  return upper;
}

export function resolveNewsWatchlistExtras(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = (env.ALPACA_WATCHLIST ?? "").trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function resolveNewsSymbolQuery(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const watchlist = resolveAlpacaWatchlist(env);
  const alpacaSymbols = watchlist.map(toAlpacaNewsSymbol);
  return [...new Set(alpacaSymbols)].join(",");
}

export function isCoreIndexSymbol(symbol: string): boolean {
  return CORE_INDEX_SYMBOLS.has(symbol.toUpperCase());
}

export function isCoreCryptoSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return (
    CORE_CRYPTO_SYMBOLS.has(normalized) ||
    normalized.endsWith("/USD") ||
    /^[A-Z]{2,5}USD$/.test(normalized)
  );
}

export function isWatchlistExtraSymbol(
  symbol: string,
  extras: readonly string[],
): boolean {
  const normalized = symbol.toUpperCase();
  if (isCoreIndexSymbol(normalized) || isCoreCryptoSymbol(normalized)) {
    return false;
  }
  return extras.includes(normalized);
}

export function defaultNewsTopics(): readonly MarketNewsTopic[] {
  return ["macro", "indices", "crypto", "watchlist"] as const;
}

export { DEFAULT_ALPACA_SYMBOLS, resolveAlpacaWatchlist };
