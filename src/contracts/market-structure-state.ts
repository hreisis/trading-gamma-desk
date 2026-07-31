import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import {
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  GammaAvailability,
  GammaDataDelay,
  GammaRegime,
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
} from "./estimated-gamma";
import {
  GAMMA_CHANGE_SET_SCHEMA_VERSION,
  GAMMA_SNAPSHOT_SCHEMA_VERSION,
  GammaBaselineRef,
  GammaChangeMetrics,
  GammaPctChange,
  GammaRegimeChange,
  GammaSnapshotCaptureKind,
} from "./gamma-snapshot";

export const MARKET_STRUCTURE_STATE_SCHEMA_VERSION = "0.1.0";
export const MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID =
  "gamma_feature_layer_v1" as const;
export const MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION = "0.1.0";

/**
 * Spot position relative to available put/call walls.
 * Exact strike equality only — no epsilon bands.
 */
export const SpotWallCorridorPosition = z.enum([
  "below_put_wall",
  "at_put_wall",
  "between_walls",
  "at_call_wall",
  "above_call_wall",
  "unavailable",
]);

export const SpotWallCorridor = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    position: z.enum([
      "below_put_wall",
      "at_put_wall",
      "between_walls",
      "at_call_wall",
      "above_call_wall",
    ]),
    putWallStrike: z.number().finite().positive(),
    callWallStrike: z.number().finite().positive(),
    spot: z.number().finite().positive(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    position: z.literal("unavailable"),
  }),
]);

/** Signed distance from spot to a wall strike (points and percent). */
export const WallDistance = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    wallStrike: z.number().finite().positive(),
    spot: z.number().finite().positive(),
    /** spot − wallStrike */
    points: z.number().finite(),
    /**
     * ((spot − wallStrike) / wallStrike) × 100.
     * Unavailable when wallStrike is exactly 0.
     */
    pct: GammaPctChange,
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const CoverageRatio = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    contractsUsed: z.number().int().nonnegative(),
    contractsIn: z.number().int().positive(),
    value: z.number().finite().min(0).max(1),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    contractsUsed: z.number().int().nonnegative().optional(),
    contractsIn: z.number().int().nonnegative().optional(),
  }),
]);

export const ZeroDteShareFeature = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    value: z.number().finite().min(0).max(1),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

/**
 * Direction from exact absoluteChange sign — no epsilon.
 * higher: absoluteChange > 0; lower: < 0; unchanged: === 0.
 */
export const GammaChangeDirection = z.enum([
  "higher",
  "lower",
  "unchanged",
  "unavailable",
]);

export const DirectedChange = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    direction: z.enum(["higher", "lower", "unchanged"]),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    direction: z.literal("unavailable"),
  }),
]);

/**
 * Change features for one baseline (prior-close or session-open).
 * Preserves M4-2 numeric metrics + unavailable reasons; adds directions.
 */
export const StructureBaselineFeatures = z.object({
  baseline: GammaBaselineRef,
  gammaRegimeTransition: GammaRegimeChange,
  totalGexDirection: DirectedChange,
  callWallShiftDirection: DirectedChange,
  putWallShiftDirection: DirectedChange,
  zeroDteShareOfGrossGexDirection: DirectedChange,
  /** Exact M4-2 metrics (including nested pct unavailable). */
  metrics: GammaChangeMetrics,
});

export const MarketStructureCurrentFeatures = z.object({
  gammaRegime: GammaRegime,
  spotWallCorridor: SpotWallCorridor,
  distanceToCallWall: WallDistance,
  distanceToPutWall: WallDistance,
  zeroDteShareOfGrossGex: ZeroDteShareFeature,
  coverageRatio: CoverageRatio,
  structureStatus: GammaAvailability,
  dataDelay: GammaDataDelay,
  synthetic: z.boolean(),
  limitations: z.array(z.string()),
});

/**
 * Deterministic desk-ready gamma features (M4-3).
 * Derived from one GammaHistoricalSnapshot + matching GammaChangeSet.
 * Not a directional forecast; no compression/amplification claims; no scores.
 */
export const MarketStructureState = z.object({
  kind: z.literal("MarketStructureState"),
  schemaVersion: z.literal(MARKET_STRUCTURE_STATE_SCHEMA_VERSION),
  snapshotId: z.string().min(1),
  underlying: z.string().min(1),
  sessionDate: IsoDate,
  asOf: IsoDateTime,
  captureKind: GammaSnapshotCaptureKind,
  methodologyId: z.literal(GEX_METHODOLOGY_ID),
  methodologyVersion: z.literal(GEX_METHODOLOGY_VERSION),
  featureMethodologyId: z.literal(MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID),
  featureMethodologyVersion: z.literal(
    MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION,
  ),
  sourceSnapshotSchemaVersion: z.literal(GAMMA_SNAPSHOT_SCHEMA_VERSION),
  sourceChangeSetSchemaVersion: z.literal(GAMMA_CHANGE_SET_SCHEMA_VERSION),
  sourceStructureSchemaVersion: z.literal(ESTIMATED_GAMMA_SCHEMA_VERSION),
  current: MarketStructureCurrentFeatures,
  versusPriorClose: StructureBaselineFeatures,
  versusSessionOpen: StructureBaselineFeatures,
});

export type SpotWallCorridorPosition = z.infer<typeof SpotWallCorridorPosition>;
export type SpotWallCorridor = z.infer<typeof SpotWallCorridor>;
export type WallDistance = z.infer<typeof WallDistance>;
export type CoverageRatio = z.infer<typeof CoverageRatio>;
export type ZeroDteShareFeature = z.infer<typeof ZeroDteShareFeature>;
export type GammaChangeDirection = z.infer<typeof GammaChangeDirection>;
export type DirectedChange = z.infer<typeof DirectedChange>;
export type StructureBaselineFeatures = z.infer<
  typeof StructureBaselineFeatures
>;
export type MarketStructureCurrentFeatures = z.infer<
  typeof MarketStructureCurrentFeatures
>;
export type MarketStructureState = z.infer<typeof MarketStructureState>;
