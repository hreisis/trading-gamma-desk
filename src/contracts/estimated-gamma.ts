import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const ESTIMATED_GAMMA_SCHEMA_VERSION = "0.1.1";
export const GEX_METHODOLOGY_ID = "oi_gex_proxy_v1";
export const GEX_METHODOLOGY_VERSION = "0.1.1";

export const GammaAvailability = z.enum([
  "available",
  "partial",
  "incomplete",
  "unavailable",
]);

export const GammaDataDelay = z.enum([
  "realtime",
  "delayed_15m",
  "eod",
  "fixture",
  "unknown",
]);

export const GammaRegime = z.enum([
  "positive",
  "negative",
  "near_zero",
  "unavailable",
]);

export const GammaStructureSource = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  fetchedAt: IsoDateTime,
});

export const GammaMethodology = z.object({
  id: z.literal(GEX_METHODOLOGY_ID),
  version: z.literal(GEX_METHODOLOGY_VERSION),
  /** Human-readable formula summary for audit. */
  formula: z.string().min(1),
  assumptions: z.array(z.string().min(1)).min(1),
});

export const StrikeGexLevel = z.object({
  strike: z.number().finite().positive(),
  callGex: z.number().finite(),
  putGex: z.number().finite(),
  netGex: z.number().finite(),
  callOpenInterest: z.number().nonnegative(),
  putOpenInterest: z.number().nonnegative(),
  callContractsUsed: z.number().int().nonnegative(),
  putContractsUsed: z.number().int().nonnegative(),
});

export const ExpiryGexBreakdown = z.object({
  expiry: IsoDate,
  status: GammaAvailability,
  callGex: z.number().finite().nullable(),
  putGex: z.number().finite().nullable(),
  netGex: z.number().finite().nullable(),
  contractsUsed: z.number().int().nonnegative(),
  contractsSkipped: z.number().int().nonnegative(),
});

/**
 * 0DTE slice for the session date. Unavailable when the chain has no
 * same-session expiry — never fabricated.
 */
export const ZeroDteGexBreakdown = z.object({
  status: GammaAvailability,
  sessionDate: IsoDate,
  expiry: IsoDate.optional(),
  callGex: z.number().finite().nullable(),
  putGex: z.number().finite().nullable(),
  netGex: z.number().finite().nullable(),
  /**
   * Gross 0DTE GEX / gross total GEX, where gross = Σ(|callGex|+|putGex|).
   * Null when gross total is 0 or 0DTE unavailable. Validated in [0, 1].
   */
  shareOfGrossGex: z
    .number()
    .finite()
    .nullable()
    .superRefine((v, ctx) => {
      if (v === null) return;
      if (v < 0 || v > 1) {
        ctx.addIssue({
          code: "custom",
          message: "shareOfGrossGex must be in [0, 1]",
        });
      }
    }),
  contractsUsed: z.number().int().nonnegative(),
  reason: z.string().optional(),
});

export const WallLevel = z.object({
  status: GammaAvailability,
  strike: z.number().finite().positive().optional(),
  /** Call wall uses call GEX; put wall uses put GEX (typically ≤ 0). */
  gex: z.number().finite().optional(),
  reason: z.string().optional(),
});

/**
 * Gamma Flip from spot-shock modeled net GEX (bounded pipeline).
 * Unavailable carries optional bounds when a crossing interval was not found.
 */
export const GammaFlipAvailable = z.object({
  status: z.literal("available"),
  strike: z.number().finite().positive(),
  level: z.number().finite().positive(),
  method: z.literal("spot_shock_bs_gamma"),
  lowerStrike: z.number().finite().positive().optional(),
  upperStrike: z.number().finite().positive().optional(),
});

export const GammaFlipUnavailable = z.object({
  status: z.literal("unavailable"),
  reason: z.string().min(1),
  lowerStrike: z.number().finite().positive().optional(),
  upperStrike: z.number().finite().positive().optional(),
  level: z.number().finite().positive().optional(),
});

export const GammaFlipLevel = z.discriminatedUnion("status", [
  GammaFlipAvailable,
  GammaFlipUnavailable,
]);

export const GexCoverage = z.object({
  contractsIn: z.number().int().nonnegative(),
  contractsUsed: z.number().int().nonnegative(),
  contractsSkipped: z.number().int().nonnegative(),
  skipReasons: z.record(z.string(), z.number().int().nonnegative()),
  nonNullGammaCount: z.number().int().nonnegative().optional(),
  usableGammaCount: z.number().int().nonnegative().optional(),
  nonNullGammaCoveragePct: z.number().finite().nonnegative().optional(),
  usableGammaCoveragePct: z.number().finite().nonnegative().optional(),
  suspectVendorGreeksCount: z.number().int().nonnegative().optional(),
});

/**
 * Estimated gamma / GEX structure from an OI-based proxy (M4-1).
 * Not dealer positioning truth; not a directional buy/sell signal.
 */
export const EstimatedGammaStructure = z.object({
  kind: z.literal("EstimatedGammaStructure"),
  schemaVersion: z.literal(ESTIMATED_GAMMA_SCHEMA_VERSION),
  underlying: z.string().min(1),
  asOf: IsoDateTime,
  sessionDate: IsoDate,
  spot: z.number().finite().positive().nullable(),
  dataDelay: GammaDataDelay,
  source: GammaStructureSource,
  methodology: GammaMethodology,
  status: GammaAvailability,
  limitations: z.array(z.string()),
  totalGex: z.number().finite().nullable(),
  gammaRegime: GammaRegime,
  callWall: WallLevel,
  putWall: WallLevel,
  gammaFlip: GammaFlipLevel,
  byStrike: z.array(StrikeGexLevel),
  byExpiry: z.array(ExpiryGexBreakdown),
  zeroDte: ZeroDteGexBreakdown,
  coverage: GexCoverage,
  synthetic: z.boolean(),
});

export type GammaAvailability = z.infer<typeof GammaAvailability>;
export type GammaDataDelay = z.infer<typeof GammaDataDelay>;
export type GammaRegime = z.infer<typeof GammaRegime>;
export type GammaStructureSource = z.infer<typeof GammaStructureSource>;
export type GammaMethodology = z.infer<typeof GammaMethodology>;
export type EstimatedGammaStructure = z.infer<typeof EstimatedGammaStructure>;
export type StrikeGexLevel = z.infer<typeof StrikeGexLevel>;
export type ExpiryGexBreakdown = z.infer<typeof ExpiryGexBreakdown>;
export type ZeroDteGexBreakdown = z.infer<typeof ZeroDteGexBreakdown>;
export type WallLevel = z.infer<typeof WallLevel>;
export type GammaFlipLevel = z.infer<typeof GammaFlipLevel>;
export type GexCoverage = z.infer<typeof GexCoverage>;
