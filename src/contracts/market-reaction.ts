import { z } from "zod";
import { IsoDateTime } from "./common";

export const MARKET_REACTION_SCHEMA_VERSION = "0.1.0";

export const ReactionDirection = z.enum([
  "up",
  "down",
  "flat",
  "unavailable",
]);

export const EquityBreadth = z.enum([
  "broadly_higher",
  "broadly_lower",
  "mixed",
  "flat",
  "unavailable",
]);

export const ReactionDevelopment = z.enum([
  "extended",
  "held",
  "faded",
  "reversed",
  "mixed",
  "unavailable",
]);

export const ReactionWindowId = z.enum(["5m", "30m", "2h", "session_close"]);

export const ReactionProxySymbol = z.enum([
  "SPY",
  "QQQ",
  "IWM",
  "TLT",
  "UUP",
  "GLD",
]);

export const EquityLeadershipStatus = z.enum([
  "nasdaq_proxy_leads",
  "small_cap_proxy_leads",
  "no_clear_leader",
  "mixed",
  "unavailable",
]);

export const CrossAssetLeg = z.enum([
  "higher",
  "lower",
  "mixed",
  "flat",
  "unavailable",
]);

export const ReactionInstrument = z.object({
  symbol: ReactionProxySymbol,
  proxyLabel: z.string().min(1),
  changePct: z.number().finite().optional(),
  direction: ReactionDirection,
  deadbandPct: z.number().nonnegative(),
  sourceBaselineTimestamp: IsoDateTime.optional(),
  sourceWindowTimestamp: IsoDateTime.optional(),
});

export const EquityLeadership = z.object({
  status: EquityLeadershipStatus,
  qqqMinusSpyPct: z.number().finite().optional(),
  iwmMinusSpyPct: z.number().finite().optional(),
  thresholdPct: z.number().nonnegative(),
});

export const CrossAssetSignature = z.object({
  equities: CrossAssetLeg,
  longTreasuryEtf: ReactionDirection,
  dollarEtf: ReactionDirection,
  goldEtf: ReactionDirection,
});

export const ReactionWindowCoverage = z.object({
  available: z.number().int().nonnegative(),
  expected: z.number().int().positive(),
  missingSymbols: z.array(z.string()),
});

export const ReactionWindowClassification = z.object({
  window: ReactionWindowId,
  instruments: z.array(ReactionInstrument),
  equityBreadth: EquityBreadth,
  equityLeadership: EquityLeadership,
  crossAssetSignature: CrossAssetSignature,
  coverage: ReactionWindowCoverage,
});

export const SymbolDevelopment = z.object({
  shortToMedium: ReactionDevelopment,
  mediumToClose: ReactionDevelopment,
});

export const ReactionDevelopmentBlock = z.object({
  from5mTo30m: ReactionDevelopment,
  from30mTo2h: ReactionDevelopment,
  intoSessionClose: ReactionDevelopment,
  bySymbol: z.record(z.string(), SymbolDevelopment),
});

export const ReactionObservation = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  window: z.string().min(1),
  symbolInputs: z.array(z.string()),
  ruleId: z.string().min(1),
  /** Replayable source fields (pct changes / directions). */
  sourceValues: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

export const MarketReactionStatus = z.enum([
  "complete",
  "partial",
  "insufficient",
]);

/**
 * Deterministic observed reaction pattern over M2-4A ETF moves (M2-4B).
 * Rule-based only — never causation, risk-on/off, or trade advice.
 */
export const EventMarketReaction = z.object({
  schemaVersion: z.literal(MARKET_REACTION_SCHEMA_VERSION),
  id: z.string().min(1),
  catalystId: z.string().min(1),
  marketContextId: z.string().min(1),
  /** Stable identity string used for cache reuse (excludes generatedAt). */
  marketContextIdentity: z.string().min(1),
  reactionRulesVersion: z.string().min(1),
  eventTimestamp: IsoDateTime,
  provider: z.string().min(1),
  feed: z.string().min(1),
  status: MarketReactionStatus,
  windows: z.array(ReactionWindowClassification),
  development: ReactionDevelopmentBlock,
  observations: z.array(ReactionObservation),
  limitations: z.array(z.string()),
  generatedAt: IsoDateTime,
  synthetic: z.boolean(),
});

export type EventMarketReaction = z.infer<typeof EventMarketReaction>;
export type ReactionDirection = z.infer<typeof ReactionDirection>;
export type EquityBreadth = z.infer<typeof EquityBreadth>;
export type ReactionDevelopment = z.infer<typeof ReactionDevelopment>;
export type ReactionWindowId = z.infer<typeof ReactionWindowId>;
export type ReactionProxySymbol = z.infer<typeof ReactionProxySymbol>;
export type EquityLeadershipStatus = z.infer<typeof EquityLeadershipStatus>;
export type CrossAssetSignature = z.infer<typeof CrossAssetSignature>;
export type CrossAssetLeg = z.infer<typeof CrossAssetLeg>;
export type ReactionWindowClassification = z.infer<
  typeof ReactionWindowClassification
>;
export type ReactionObservation = z.infer<typeof ReactionObservation>;
export type MarketReactionStatus = z.infer<typeof MarketReactionStatus>;
export type ReactionInstrument = z.infer<typeof ReactionInstrument>;
export type EquityLeadership = z.infer<typeof EquityLeadership>;
export type ReactionDevelopmentBlock = z.infer<typeof ReactionDevelopmentBlock>;
