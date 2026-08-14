import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const BREADTH_INTERNALS_SCHEMA_VERSION = "0.2.0" as const;
export const BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION = "0.1.0" as const;

export const BREADTH_INTERNALS_SCHEMA_VERSIONS = [
  BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION,
  BREADTH_INTERNALS_SCHEMA_VERSION,
] as const;

export const BreadthMetricStatus = z.enum([
  "available",
  "partial",
  "unavailable",
]);

export const BreadthMetricResult = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  eligibleCount: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  status: BreadthMetricStatus,
  missingReason: z.string().nullable(),
});

/** Advance/decline counts — no synthetic numerator; invariant enforced in schema. */
export const BreadthAdvanceDeclineMetric = z
  .object({
    advance: z.number().int().nonnegative(),
    decline: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1),
    status: BreadthMetricStatus,
    missingReason: z.string().nullable(),
  })
  .superRefine((metric, ctx) => {
    const total = metric.advance + metric.decline + metric.unchanged;
    if (total !== metric.eligibleCount) {
      ctx.addIssue({
        code: "custom",
        path: ["eligibleCount"],
        message: "advance + decline + unchanged must equal eligibleCount",
      });
    }
    if (metric.eligibleCount !== metric.denominator) {
      ctx.addIssue({
        code: "custom",
        path: ["denominator"],
        message: "eligibleCount must equal denominator for advanceDecline",
      });
    }
  });

export const BreadthCoverageGatesLegacy = z.object({
  pricePairCoverage: z.number().min(0).max(1),
  ma20Coverage: z.number().min(0).max(1),
  ma50Coverage: z.number().min(0).max(1),
  highLow20Coverage: z.number().min(0).max(1),
});

export const BreadthCoverageGates = z.object({
  pricePairCoverage: z.number().min(0).max(1),
  ma20Coverage: z.number().min(0).max(1),
  ma50Coverage: z.number().min(0).max(1),
  closingHighLow20Coverage: z.number().min(0).max(1),
});

export const BreadthUniverseId = z.enum(["spy_etf_holdings", "qqq_etf_holdings"]);
export const BreadthFundSymbol = z.enum(["SPY", "QQQ"]);

export const BreadthUniverseProvenance = z.object({
  universeId: BreadthUniverseId,
  fundSymbol: BreadthFundSymbol,
  provenanceType: z.literal("official_etf_holdings"),
  provider: z.string().min(1),
  sourceUrl: z.string().url(),
  asOf: IsoDate,
  fetchedAt: IsoDateTime,
  sessionLag: z.number().int().nonnegative().nullable(),
  stale: z.boolean(),
});

export const BreadthBarsProvenance = z.object({
  provider: z.literal("alpaca"),
  priceFeed: z.enum(["iex", "sip"]),
  isConsolidated: z.boolean(),
  adjustment: z.literal("split"),
  requestedSymbols: z.number().int().nonnegative(),
  returnedSymbols: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  pages: z.number().int().nonnegative(),
  fetchedAt: IsoDateTime,
  latestSessionDate: IsoDate.nullable(),
  failedSymbols: z.array(z.string()),
});

export const BreadthInternalsSnapshotLegacy = z.object({
  kind: z.literal("BreadthInternals"),
  schemaVersion: z.literal(BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION),
  marketSessionDate: IsoDate,
  asOf: IsoDateTime,
  advance: z.number().int().nonnegative(),
  decline: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  metrics: z.object({
    advanceDecline: BreadthAdvanceDeclineMetric,
    percentAboveMA20: BreadthMetricResult,
    percentAboveMA50: BreadthMetricResult,
    new20DayHigh: BreadthMetricResult,
    new20DayLow: BreadthMetricResult,
  }),
  coverage: BreadthCoverageGatesLegacy,
  universe: BreadthUniverseProvenance,
  bars: BreadthBarsProvenance,
  status: BreadthMetricStatus,
  stale: z.boolean(),
  missingReason: z.string().nullable(),
});

export const BreadthInternalsSnapshot = z.object({
  kind: z.literal("BreadthInternals"),
  schemaVersion: z.literal(BREADTH_INTERNALS_SCHEMA_VERSION),
  marketSessionDate: IsoDate,
  asOf: IsoDateTime,
  advance: z.number().int().nonnegative(),
  decline: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  metrics: z.object({
    advanceDecline: BreadthAdvanceDeclineMetric,
    percentAboveMA20: BreadthMetricResult,
    percentAboveMA50: BreadthMetricResult,
    new20DayClosingHigh: BreadthMetricResult,
    new20DayClosingLow: BreadthMetricResult,
  }),
  coverage: BreadthCoverageGates,
  universe: BreadthUniverseProvenance,
  bars: BreadthBarsProvenance,
  status: BreadthMetricStatus,
  stale: z.boolean(),
  missingReason: z.string().nullable(),
});

export const StoredBreadthInternalsSnapshot = z.discriminatedUnion(
  "schemaVersion",
  [BreadthInternalsSnapshotLegacy, BreadthInternalsSnapshot],
);

export type BreadthCoverageGatesLegacy = z.infer<typeof BreadthCoverageGatesLegacy>;
export type BreadthMetricStatus = z.infer<typeof BreadthMetricStatus>;
export type BreadthMetricResult = z.infer<typeof BreadthMetricResult>;
export type BreadthAdvanceDeclineMetric = z.infer<
  typeof BreadthAdvanceDeclineMetric
>;
export type BreadthInternalsSnapshot = z.infer<typeof BreadthInternalsSnapshot>;
export type BreadthInternalsSnapshotLegacy = z.infer<
  typeof BreadthInternalsSnapshotLegacy
>;
export type StoredBreadthInternalsSnapshot = z.infer<
  typeof StoredBreadthInternalsSnapshot
>;

export function isCurrentBreadthInternalsSnapshot(
  snapshot: StoredBreadthInternalsSnapshot,
): snapshot is BreadthInternalsSnapshot {
  return snapshot.schemaVersion === BREADTH_INTERNALS_SCHEMA_VERSION;
}

export function isLegacyBreadthInternalsSnapshot(
  snapshot: StoredBreadthInternalsSnapshot,
): snapshot is BreadthInternalsSnapshotLegacy {
  return snapshot.schemaVersion === BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION;
}
