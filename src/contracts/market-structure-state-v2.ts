import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import {
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  GammaAvailability,
  GammaDataDelay,
  GammaFlipLevel,
  GammaRegime,
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
} from "./estimated-gamma";
import {
  BoundedWallLevel,
  BOUNDED_GAMMA_SCOPE,
  BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION,
} from "./bounded-gamma-provider";
import {
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
  StructureBaselineFeatures,
  SpotWallCorridor,
  WallDistance,
  CoverageRatio,
  ZeroDteShareFeature,
} from "./market-structure-state";

export const MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION = "0.2.0";
export const MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2 = "0.2.0";

/**
 * Conditional structure descriptors (M4-3 interpretation layer).
 * Driven by GEX regime + availability/completeness — not directional forecasts.
 */
export const StructureConditionState = z.enum([
  "positive_gamma_stabilizing",
  "negative_gamma_amplifying",
  "near_zero_transition",
  "incomplete_structure",
  "unavailable",
]);

export const StructureEvidenceEntry = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  /** Numeric or categorical basis for audit — not a score. */
  basis: z.string().min(1),
});

export const StructureInterpretation = z.object({
  summary: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(1),
});

export const StructureChangeContext = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    versusPriorClose: StructureBaselineFeatures,
    versusSessionOpen: StructureBaselineFeatures,
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const StructureCoverageSummary = z.object({
  contractsIn: z.number().int().nonnegative(),
  contractsUsed: z.number().int().nonnegative(),
  contractsSkipped: z.number().int().nonnegative(),
  skipReasons: z.record(z.string(), z.number().int().nonnegative()),
  nonNullGammaCount: z.number().int().nonnegative().optional(),
  usableGammaCount: z.number().int().nonnegative().optional(),
  nonNullGammaCoveragePct: z.number().finite().nonnegative().optional(),
  usableGammaCoveragePct: z.number().finite().nonnegative().optional(),
  suspectVendorGreeksCount: z.number().int().nonnegative().optional(),
  coverageRatio: CoverageRatio,
});

/**
 * MarketStructureState schemaVersion 0.2.0 — bounded-aware interpretation layer.
 * Coexists with 0.1.0 snapshot+change feature state; does not replace it.
 */
export const MarketStructureStateV2 = z.object({
  kind: z.literal("MarketStructureState"),
  schemaVersion: z.literal(MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION),
  symbol: z.string().min(1),
  generatedAt: IsoDateTime,
  asOf: IsoDateTime,
  vendorAsOf: IsoDateTime.optional(),
  sessionDate: IsoDate,
  source: z.object({
    provider: z.string().min(1),
    name: z.string().min(1),
    fetchedAt: IsoDateTime,
  }),
  methodology: z.object({
    id: z.literal(GEX_METHODOLOGY_ID),
    version: z.literal(GEX_METHODOLOGY_VERSION),
    featureMethodologyId: z.literal(MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID),
    featureMethodologyVersion: z.literal(
      MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2,
    ),
  }),
  scope: z.literal(BOUNDED_GAMMA_SCOPE),
  expiration: IsoDate,
  dte: z.number().int().nonnegative(),
  zeroDteStatus: GammaAvailability,
  availability: GammaAvailability,
  dataDelay: GammaDataDelay,
  limitations: z.array(z.string()),
  synthetic: z.boolean(),
  sourceBoundedSchemaVersion: z.literal(BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION),
  sourceStructureSchemaVersion: z.literal(ESTIMATED_GAMMA_SCHEMA_VERSION),
  regime: GammaRegime,
  spot: z.number().finite().positive().nullable(),
  totalGex: z.number().finite().nullable(),
  grossGex: z.number().finite().nonnegative(),
  boundedCallWall: BoundedWallLevel,
  boundedPutWall: BoundedWallLevel,
  /** Always unavailable unless a future supported input supplies flip — never interpolated. */
  flip: GammaFlipLevel,
  spotWallCorridor: SpotWallCorridor,
  distanceToBoundedCallWall: WallDistance,
  distanceToBoundedPutWall: WallDistance,
  zeroDteShareOfGrossGex: ZeroDteShareFeature,
  coverage: StructureCoverageSummary,
  condition: StructureConditionState,
  evidence: z.array(StructureEvidenceEntry).min(1),
  interpretation: StructureInterpretation,
  changeContext: StructureChangeContext,
});

export type StructureConditionState = z.infer<typeof StructureConditionState>;
export type StructureEvidenceEntry = z.infer<typeof StructureEvidenceEntry>;
export type StructureInterpretation = z.infer<typeof StructureInterpretation>;
export type StructureChangeContext = z.infer<typeof StructureChangeContext>;
export type StructureCoverageSummary = z.infer<typeof StructureCoverageSummary>;
export type MarketStructureStateV2 = z.infer<typeof MarketStructureStateV2>;
