import type { AlpacaClient } from "@/alpaca/client";
import type { MarketNewsItem } from "@/contracts/market-news";
import {
  fromAlpacaNewsSymbol,
  MARKET_NEWS_MACRO_LIMIT,
  MARKET_NEWS_STALE_MS,
  MARKET_NEWS_SYMBOLS_LIMIT,
} from "./config";

interface AlpacaNewsArticle {
  readonly id: number;
  readonly headline: string;
  readonly summary: string;
  readonly source: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly symbols: string[];
  readonly url?: string | null;
}

interface AlpacaNewsResponse {
  readonly news: AlpacaNewsArticle[];
  readonly next_page_token?: string | null;
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid news timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function itemStatus(
  publishedAt: string,
  now: Date,
  staleMs: number,
): MarketNewsItem["status"] {
  const ageMs = now.getTime() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs)) return "unavailable";
  return ageMs > staleMs ? "stale" : "available";
}

export function mapAlpacaNewsArticle(
  article: AlpacaNewsArticle,
  now: Date,
  staleMs: number = MARKET_NEWS_STALE_MS,
): MarketNewsItem {
  const publishedAt = normalizeTimestamp(article.created_at);
  const updatedAt = normalizeTimestamp(article.updated_at);
  const symbols = [...new Set(article.symbols.map(fromAlpacaNewsSymbol))];

  return {
    id: String(article.id),
    headline: article.headline.trim(),
    summary: article.summary.trim(),
    source: article.source.trim(),
    publishedAt,
    updatedAt,
    symbols,
    topics: [],
    url: article.url?.trim() ? article.url.trim() : null,
    itemSource: "alpaca",
    status: itemStatus(publishedAt, now, staleMs),
  };
}

export async function fetchAlpacaNewsArticles(options: {
  readonly client: AlpacaClient;
  readonly symbols?: string;
  readonly limit: number;
  readonly now?: Date;
  readonly staleMs?: number;
}): Promise<MarketNewsItem[]> {
  const now = options.now ?? new Date();
  const query: Record<string, string> = {
    limit: String(Math.min(Math.max(options.limit, 1), 50)),
    sort: "desc",
    include_content: "false",
    exclude_contentless: "true",
  };
  if (options.symbols?.trim()) {
    query.symbols = options.symbols.trim();
  }

  const response = await options.client.getJson<AlpacaNewsResponse>(
    "/v1beta1/news",
    query,
  );

  return (response.news ?? []).map((article) =>
    mapAlpacaNewsArticle(article, now, options.staleMs),
  );
}

export async function fetchAlpacaNewsBundle(options: {
  readonly client: AlpacaClient;
  readonly symbolQuery: string;
  readonly now?: Date;
  readonly staleMs?: number;
}): Promise<{
  readonly macroItems: MarketNewsItem[];
  readonly symbolItems: MarketNewsItem[];
}> {
  const [macroItems, symbolItems] = await Promise.all([
    fetchAlpacaNewsArticles({
      client: options.client,
      limit: MARKET_NEWS_MACRO_LIMIT,
      now: options.now,
      staleMs: options.staleMs,
    }),
    fetchAlpacaNewsArticles({
      client: options.client,
      symbols: options.symbolQuery,
      limit: MARKET_NEWS_SYMBOLS_LIMIT,
      now: options.now,
      staleMs: options.staleMs,
    }),
  ]);

  return { macroItems, symbolItems };
}
