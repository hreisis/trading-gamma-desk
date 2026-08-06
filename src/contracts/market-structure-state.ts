import { z } from "zod";
import {
  GammaBaselineRef,
  GammaChangeMetrics,
  GammaPctChange,
  GammaRegimeChange,
} from "./gamma-change";

export const MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID =
  "gamma_feature_layer_v1" as const;

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
 * Preserves numeric metrics + unavailable reasons; adds directions.
 */
export const StructureBaselineFeatures = z.object({
  baseline: GammaBaselineRef,
  gammaRegimeTransition: GammaRegimeChange,
  totalGexDirection: DirectedChange,
  callWallShiftDirection: DirectedChange,
  putWallShiftDirection: DirectedChange,
  zeroDteShareOfGrossGexDirection: DirectedChange,
  metrics: GammaChangeMetrics,
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
