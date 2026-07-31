import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import {
  EstimatedGammaStructure,
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
  GammaRegime,
} from "./estimated-gamma";

export const GAMMA_SNAPSHOT_SCHEMA_VERSION = "0.1.0";
export const GAMMA_CHANGE_SET_SCHEMA_VERSION = "0.1.0";

/**
 * Explicit capture kind — never inferred from clock time.
 * Callers must label open / intraday / close at write time.
 */
export const GammaSnapshotCaptureKind = z.enum([
  "open",
  "intraday",
  "close",
]);

/**
 * Immutable as-of gamma snapshot (M4-2).
 * Embeds the full M4-1 EstimatedGammaStructure; identity is stable and
 * append-only in storage.
 */
export const GammaHistoricalSnapshot = z.object({
  kind: z.literal("GammaHistoricalSnapshot"),
  schemaVersion: z.literal(GAMMA_SNAPSHOT_SCHEMA_VERSION),
  /** Stable identity: underlying|sessionDate|captureKind|asOf */
  snapshotId: z.string().min(1),
  captureKind: GammaSnapshotCaptureKind,
  capturedAt: IsoDateTime,
  underlying: z.string().min(1),
  sessionDate: IsoDate,
  asOf: IsoDateTime,
  structureSchemaVersion: z.string().min(1),
  methodologyId: z.literal(GEX_METHODOLOGY_ID),
  methodologyVersion: z.literal(GEX_METHODOLOGY_VERSION),
  structure: EstimatedGammaStructure,
});

export const GammaBaselineAvailability = z.enum(["available", "unavailable"]);

export const GammaBaselineRef = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    snapshotId: z.string().min(1),
    sessionDate: IsoDate,
    captureKind: GammaSnapshotCaptureKind,
    asOf: IsoDateTime,
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const GammaNumericChange = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    current: z.number().finite(),
    baseline: z.number().finite(),
    absoluteChange: z.number().finite(),
    /**
     * Percent change vs baseline: ((current - baseline) / baseline) * 100.
     * Null when baseline is exactly 0 (division undefined).
     */
    pctChange: z.number().finite().nullable(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    current: z.number().finite().nullable().optional(),
    baseline: z.number().finite().nullable().optional(),
  }),
]);

export const GammaRegimeChange = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    current: GammaRegime,
    baseline: GammaRegime,
    changed: z.boolean(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    current: GammaRegime.optional(),
    baseline: GammaRegime.optional(),
  }),
]);

export const GammaWallChange = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    currentStrike: z.number().finite().positive(),
    baselineStrike: z.number().finite().positive(),
    absoluteChange: z.number().finite(),
    /** Null when baseline strike is 0 (should not occur for positive strikes). */
    pctChange: z.number().finite().nullable(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
    currentStrike: z.number().finite().positive().optional(),
    baselineStrike: z.number().finite().positive().optional(),
  }),
]);

export const GammaChangeMetrics = z.object({
  spot: GammaNumericChange,
  totalGex: GammaNumericChange,
  gammaRegime: GammaRegimeChange,
  callWall: GammaWallChange,
  putWall: GammaWallChange,
  /** 0DTE shareOfGrossGex (gross 0DTE / gross total). */
  zeroDteShareOfGrossGex: GammaNumericChange,
});

export const GammaBaselineComparison = z.object({
  baseline: GammaBaselineRef,
  metrics: GammaChangeMetrics,
});

/**
 * Deterministic change set vs prior-session close and same-session open.
 * Missing baselines or metrics are explicit unavailable + reason — never filled.
 */
export const GammaChangeSet = z.object({
  kind: z.literal("GammaChangeSet"),
  schemaVersion: z.literal(GAMMA_CHANGE_SET_SCHEMA_VERSION),
  currentSnapshotId: z.string().min(1),
  underlying: z.string().min(1),
  sessionDate: IsoDate,
  asOf: IsoDateTime,
  captureKind: GammaSnapshotCaptureKind,
  methodologyId: z.literal(GEX_METHODOLOGY_ID),
  methodologyVersion: z.literal(GEX_METHODOLOGY_VERSION),
  versusPriorClose: GammaBaselineComparison,
  versusSessionOpen: GammaBaselineComparison,
});

export type GammaSnapshotCaptureKind = z.infer<typeof GammaSnapshotCaptureKind>;
export type GammaHistoricalSnapshot = z.infer<typeof GammaHistoricalSnapshot>;
export type GammaBaselineRef = z.infer<typeof GammaBaselineRef>;
export type GammaNumericChange = z.infer<typeof GammaNumericChange>;
export type GammaRegimeChange = z.infer<typeof GammaRegimeChange>;
export type GammaWallChange = z.infer<typeof GammaWallChange>;
export type GammaChangeMetrics = z.infer<typeof GammaChangeMetrics>;
export type GammaBaselineComparison = z.infer<typeof GammaBaselineComparison>;
export type GammaChangeSet = z.infer<typeof GammaChangeSet>;
