import { z } from "zod";
import { IsoDateTime, MacroSymbol, SemVer } from "./common";

export const CATALYST_SCHEMA_VERSION = "0.1.0";

export const CatalystCategory = z.enum([
  "monetary-policy",
  "inflation",
  "labor",
  "growth",
  "fiscal",
  "geopolitics",
  "energy",
  "liquidity",
  "earnings",
  "positioning",
  "other",
]);

export const CatalystStatus = z.enum([
  "upcoming",
  "released",
  "developing",
  "resolved",
]);

export const CatalystImportance = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const CatalystDirection = z.enum([
  "risk-on",
  "risk-off",
  "inflationary",
  "disinflationary",
  "growth-positive",
  "growth-negative",
  "mixed",
  "unclear",
]);

export const CatalystSourceType = z.enum([
  "calendar",
  "news",
  "social",
  "manual",
  "synthetic",
]);

/** Macro channels a catalyst may stress — editorial, not a regime claim. */
export const CatalystMacroChannel = z.enum([
  "fed_rates",
  "inflation",
  "growth",
  "liquidity",
  "risk_sentiment",
  "energy",
  "earnings",
  "other",
]);

/**
 * Classification confidence only — how clear the catalyst taxonomy is.
 * Never a market-up probability. Always uncalibrated in M2-1.
 */
export const CatalystConfidence = z.object({
  score: z.number().int().min(0).max(100),
  calibrated: z.literal(false),
  note: z.literal(
    "classification clarity only — not a market direction probability",
  ),
});

export const CatalystEvidence = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  basis: z.string().min(1),
});

export const CatalystAffectedAsset = z.union([
  MacroSymbol,
  z.string().min(1).max(32),
]);

export const Catalyst = z.object({
  schemaVersion: z.literal(CATALYST_SCHEMA_VERSION),
  id: z.string().min(1),
  occurredAt: IsoDateTime,
  observedAt: IsoDateTime,
  sourceType: CatalystSourceType,
  sourceName: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  headline: z.string().min(1),
  summary: z.string().min(1),
  category: CatalystCategory,
  importance: CatalystImportance,
  status: CatalystStatus,
  affectedAssets: z.array(CatalystAffectedAsset),
  macroChannels: z.array(CatalystMacroChannel).nonempty(),
  direction: CatalystDirection,
  confidence: CatalystConfidence,
  evidence: z.array(CatalystEvidence).nonempty(),
  dedupeKey: z.string().min(1),
  /** Always true for M2-1 fixture ingestion. */
  synthetic: z.literal(true),
});

export type Catalyst = z.infer<typeof Catalyst>;
export type CatalystCategory = z.infer<typeof CatalystCategory>;
export type CatalystStatus = z.infer<typeof CatalystStatus>;
export type CatalystImportance = z.infer<typeof CatalystImportance>;
export type CatalystDirection = z.infer<typeof CatalystDirection>;
export type CatalystSourceType = z.infer<typeof CatalystSourceType>;
export type CatalystMacroChannel = z.infer<typeof CatalystMacroChannel>;
export type CatalystConfidence = z.infer<typeof CatalystConfidence>;
export type CatalystEvidence = z.infer<typeof CatalystEvidence>;

export const IMPORTANCE_RANK: Record<CatalystImportance, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function compareCatalystImportance(
  a: CatalystImportance,
  b: CatalystImportance,
): number {
  return IMPORTANCE_RANK[a] - IMPORTANCE_RANK[b];
}
