import { z } from "zod";
import { IsoDateTime } from "./common";

export const ALPACA_MARKET_PANEL_SCHEMA_VERSION = "0.1.0";

export const AlpacaMarketQuoteSource = z.enum([
  "alpaca",
  "synthetic_demo",
  "unavailable",
]);

export const AlpacaMarketQuoteStatus = z.enum([
  "available",
  "unavailable",
  "stale",
]);

export const AlpacaMarketQuote = z.object({
  symbol: z.string().min(1),
  latestPrice: z.number().nullable(),
  dailyChangePct: z.number().nullable(),
  timestamp: IsoDateTime.nullable(),
  source: AlpacaMarketQuoteSource,
  status: AlpacaMarketQuoteStatus,
  error: z.string().optional(),
});

export const AlpacaCredentialState = z.enum([
  "configured",
  "missing",
  "invalid",
]);

export const AlpacaHealthStatus = z.object({
  kind: z.literal("AlpacaHealthStatus"),
  schemaVersion: z.literal(ALPACA_MARKET_PANEL_SCHEMA_VERSION),
  checkedAt: IsoDateTime,
  configured: z.boolean(),
  credentialState: AlpacaCredentialState,
  reachable: z.boolean(),
  message: z.string().min(1),
  isPublicDemo: z.boolean(),
  source: z.enum(["alpaca", "synthetic_demo", "unavailable"]),
});

export const AlpacaMarketPanel = z.object({
  kind: z.literal("AlpacaMarketPanel"),
  schemaVersion: z.literal(ALPACA_MARKET_PANEL_SCHEMA_VERSION),
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
  health: AlpacaHealthStatus,
  quotes: z.array(AlpacaMarketQuote),
  watchlist: z.array(z.string().min(1)),
});

export type AlpacaMarketQuote = z.infer<typeof AlpacaMarketQuote>;
export type AlpacaHealthStatus = z.infer<typeof AlpacaHealthStatus>;
export type AlpacaMarketPanel = z.infer<typeof AlpacaMarketPanel>;
