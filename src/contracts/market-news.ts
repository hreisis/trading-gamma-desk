import { z } from "zod";
import { IsoDateTime } from "./common";

export const MARKET_NEWS_PANEL_SCHEMA_VERSION = "0.1.0";

export const MarketNewsTopic = z.enum([
  "macro",
  "indices",
  "crypto",
  "watchlist",
]);

export const MarketNewsItemSource = z.enum([
  "alpaca",
  "synthetic_demo",
  "unavailable",
]);

export const MarketNewsItemStatus = z.enum([
  "available",
  "stale",
  "unavailable",
]);

export const MarketNewsItem = z.object({
  id: z.string().min(1),
  headline: z.string().min(1),
  summary: z.string().min(1),
  source: z.string().min(1),
  publishedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  symbols: z.array(z.string().min(1)),
  topics: z.array(MarketNewsTopic),
  url: z.string().url().nullable(),
  itemSource: MarketNewsItemSource,
  status: MarketNewsItemStatus,
});

export const MarketNewsSectionStatus = z.enum([
  "ready",
  "empty",
  "error",
  "unavailable",
]);

export const MarketNewsSection = z.object({
  topic: MarketNewsTopic,
  label: z.string().min(1),
  status: MarketNewsSectionStatus,
  message: z.string().optional(),
  items: z.array(MarketNewsItem),
});

export const MarketNewsPanel = z.object({
  kind: z.literal("MarketNewsPanel"),
  schemaVersion: z.literal(MARKET_NEWS_PANEL_SCHEMA_VERSION),
  fetchedAt: IsoDateTime,
  configured: z.boolean(),
  status: z.enum([
    "ready",
    "not_configured",
    "error",
    "synthetic_demo",
    "partial",
  ]),
  message: z.string().min(1),
  provider: z.enum(["alpaca", "synthetic_demo", "unavailable"]),
  sections: z.array(MarketNewsSection),
  diagnostics: z
    .object({
      macroRawCount: z.number().int().nonnegative(),
      symbolRawCount: z.number().int().nonnegative(),
      categorizedCounts: z.object({
        macro: z.number().int().nonnegative(),
        indices: z.number().int().nonnegative(),
        crypto: z.number().int().nonnegative(),
        watchlist: z.number().int().nonnegative(),
      }),
      providerStatus: z.string().optional(),
      providerError: z.string().optional(),
    })
    .optional(),
});

export type MarketNewsTopic = z.infer<typeof MarketNewsTopic>;
export type MarketNewsItem = z.infer<typeof MarketNewsItem>;
export type MarketNewsSection = z.infer<typeof MarketNewsSection>;
export type MarketNewsPanel = z.infer<typeof MarketNewsPanel>;

export const MARKET_NEWS_SECTION_LABELS: Record<MarketNewsTopic, string> = {
  macro: "Macro & broad market",
  indices: "SPY / QQQ",
  crypto: "Crypto",
  watchlist: "Watchlist",
};
