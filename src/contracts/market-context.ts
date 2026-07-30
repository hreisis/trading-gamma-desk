import { z } from "zod";
import { IsoDateTime } from "./common";

export const MARKET_CONTEXT_SCHEMA_VERSION = "0.1.0";

export const MarketContextStatus = z.enum([
  "complete",
  "partial",
  "unavailable",
]);

export const MarketContextWindowKind = z.enum([
  "plus5m",
  "plus30m",
  "plus2h",
  "sessionClose",
]);

export const MarketContextPricePoint = z.object({
  price: z.number().finite(),
  barTimestamp: IsoDateTime,
});

export const MarketContextWindow = z.object({
  kind: MarketContextWindowKind,
  status: z.enum(["available", "unavailable"]),
  price: z.number().finite().optional(),
  barTimestamp: IsoDateTime.optional(),
  /** Percent change vs baseline; null when unavailable. */
  pctChange: z.number().finite().nullable(),
});

export const MarketContextSymbolSnapshot = z.object({
  symbol: z.string().min(1),
  /** Explicit ETF/proxy label — never index/yield names. */
  instrumentLabel: z.string().min(1),
  /** Editorial proxy role, e.g. "US equities". */
  proxyRole: z.string().min(1),
  baseline: MarketContextPricePoint.nullable(),
  windows: z.array(MarketContextWindow).length(4),
  missingWindows: z.array(MarketContextWindowKind),
});

export const MarketContextSessionMeta = z.object({
  easternDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal("America/New_York"),
  isHoliday: z.boolean(),
  isWeekend: z.boolean(),
  isEarlyClose: z.boolean(),
  regularSessionOpenEt: z.string().optional(),
  regularSessionCloseEt: z.string().optional(),
  eventInPremarket: z.boolean(),
  eventInRegularSession: z.boolean(),
});

/**
 * Observed ETF moves around a catalyst release (M2-4A).
 * Objective market movement only — never causation claims.
 */
export const EventMarketContext = z.object({
  schemaVersion: z.literal(MARKET_CONTEXT_SCHEMA_VERSION),
  id: z.string().min(1),
  catalystId: z.string().min(1),
  releaseFamily: z.string().min(1).optional(),
  eventTimestamp: IsoDateTime,
  provider: z.string().min(1),
  feed: z.string().min(1),
  calculationVersion: z.string().min(1),
  timeframe: z.literal("1Min"),
  timezone: z.literal("America/New_York"),
  status: MarketContextStatus,
  fetchedAt: IsoDateTime,
  session: MarketContextSessionMeta,
  symbols: z.array(MarketContextSymbolSnapshot),
  errors: z.array(z.string()),
  synthetic: z.boolean(),
});

export type EventMarketContext = z.infer<typeof EventMarketContext>;
export type MarketContextStatus = z.infer<typeof MarketContextStatus>;
export type MarketContextWindowKind = z.infer<typeof MarketContextWindowKind>;
export type MarketContextWindow = z.infer<typeof MarketContextWindow>;
export type MarketContextSymbolSnapshot = z.infer<
  typeof MarketContextSymbolSnapshot
>;
export type MarketContextSessionMeta = z.infer<typeof MarketContextSessionMeta>;
export type MarketContextPricePoint = z.infer<typeof MarketContextPricePoint>;
