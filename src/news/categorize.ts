import type {
  MarketNewsItem,
  MarketNewsSection,
  MarketNewsTopic,
} from "@/contracts/market-news";
import { MARKET_NEWS_SECTION_LABELS } from "@/contracts/market-news";
import {
  fromAlpacaNewsSymbol,
  isCoreCryptoSymbol,
  isCoreIndexSymbol,
  isWatchlistExtraSymbol,
} from "./config";

export function categorizeNewsItem(
  item: MarketNewsItem,
  watchlistExtras: readonly string[],
): MarketNewsTopic[] {
  const topics = new Set<MarketNewsTopic>();
  for (const raw of item.symbols) {
    const symbol = fromAlpacaNewsSymbol(raw);
    if (isCoreIndexSymbol(symbol)) topics.add("indices");
    if (isCoreCryptoSymbol(symbol)) topics.add("crypto");
    if (isWatchlistExtraSymbol(symbol, watchlistExtras)) topics.add("watchlist");
  }
  return [...topics];
}

export function assignMacroTopic(item: MarketNewsItem): MarketNewsItem {
  return {
    ...item,
    topics: ["macro"],
  };
}

export function distributeNewsItems(input: {
  readonly macroItems: readonly MarketNewsItem[];
  readonly symbolItems: readonly MarketNewsItem[];
  readonly watchlistExtras: readonly string[];
}): Record<MarketNewsTopic, MarketNewsItem[]> {
  const buckets: Record<MarketNewsTopic, MarketNewsItem[]> = {
    macro: [],
    indices: [],
    crypto: [],
    watchlist: [],
  };
  const seen: Record<MarketNewsTopic, Set<string>> = {
    macro: new Set(),
    indices: new Set(),
    crypto: new Set(),
    watchlist: new Set(),
  };

  for (const item of input.macroItems) {
    const macroItem = assignMacroTopic(item);
    if (!seen.macro.has(macroItem.id)) {
      seen.macro.add(macroItem.id);
      buckets.macro.push(macroItem);
    }
  }

  for (const item of input.symbolItems) {
    const topics = categorizeNewsItem(item, input.watchlistExtras);
    for (const topic of topics) {
      if (seen[topic].has(item.id)) continue;
      seen[topic].add(item.id);
      buckets[topic].push({ ...item, topics: [topic] });
    }
  }

  return buckets;
}

export function buildNewsSections(input: {
  readonly buckets: Record<MarketNewsTopic, MarketNewsItem[]>;
  readonly sectionErrors?: Partial<Record<MarketNewsTopic, string>>;
  readonly unavailable?: boolean;
}): MarketNewsSection[] {
  const topics: MarketNewsTopic[] = ["macro", "indices", "crypto", "watchlist"];
  return topics.map((topic) => {
    const items = input.buckets[topic] ?? [];
    const error = input.sectionErrors?.[topic];
    if (input.unavailable) {
      return {
        topic,
        label: MARKET_NEWS_SECTION_LABELS[topic],
        status: "unavailable" as const,
        message: "Alpaca not configured",
        items: [],
      };
    }
    if (error) {
      return {
        topic,
        label: MARKET_NEWS_SECTION_LABELS[topic],
        status: "error" as const,
        message: error,
        items: [],
      };
    }
    if (items.length === 0) {
      return {
        topic,
        label: MARKET_NEWS_SECTION_LABELS[topic],
        status: "empty" as const,
        message: "No recent headlines in this window",
        items: [],
      };
    }
    return {
      topic,
      label: MARKET_NEWS_SECTION_LABELS[topic],
      status: "ready" as const,
      items,
    };
  });
}
