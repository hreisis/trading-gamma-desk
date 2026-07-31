import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import {
  ExpiryGexBreakdown,
  GammaAvailability,
  GammaRegime,
  StrikeGexLevel,
  WallLevel,
  ZeroDteGexBreakdown,
} from "./estimated-gamma";

export const BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION = "0.1.0";
export const BOUNDED_GAMMA_SCOPE = "bounded_single_expiry" as const;

export const BoundedWallLevel = WallLevel.extend({
  /** Explicit scope — never an unqualified “market wall”. */
  scope: z.literal(BOUNDED_GAMMA_SCOPE),
});

export const BoundedGammaProviderCredits = z.object({
  consumed: z.number().int().nonnegative().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
});

export const BoundedGammaStrikeRequest = z.object({
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
  strikeCount: z.number().int().positive(),
  estimatedMaxContracts: z.number().int().positive(),
});

export const BoundedGammaStrikeReturned = z.object({
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
});

/**
 * Derived bounded MarketData.app → Gamma Engine snapshot for UI consumption.
 * Not a full-chain wall product. Embeds engine outputs without recomputing GEX.
 */
export const BoundedGammaProviderSnapshot = z.object({
  kind: z.literal("BoundedGammaProviderSnapshot"),
  schemaVersion: z.literal(BOUNDED_GAMMA_PROVIDER_SCHEMA_VERSION),
  symbol: z.string().min(1),
  source: z.object({
    provider: z.literal("marketdata_app"),
    name: z.string().min(1),
    fetchedAt: IsoDateTime,
  }),
  generatedAt: IsoDateTime,
  vendorAsOf: IsoDateTime,
  vendorUpdatedMin: IsoDateTime,
  vendorUpdatedMax: IsoDateTime,
  sessionDate: IsoDate,
  expiration: IsoDate,
  dte: z.number().int().nonnegative(),
  zeroDte: ZeroDteGexBreakdown,
  spot: z.number().finite().positive().nullable(),
  strikeRequest: BoundedGammaStrikeRequest,
  strikeReturned: BoundedGammaStrikeReturned,
  scope: z.literal(BOUNDED_GAMMA_SCOPE),
  httpStatus: z.number().int().positive(),
  credits: BoundedGammaProviderCredits,
  status: GammaAvailability,
  limitations: z.array(z.string()),
  totalGex: z.number().finite().nullable(),
  grossGex: z.number().finite().nonnegative(),
  gammaRegime: GammaRegime,
  boundedCallWall: BoundedWallLevel,
  boundedPutWall: BoundedWallLevel,
  byStrike: z.array(StrikeGexLevel),
  byExpiry: z.array(ExpiryGexBreakdown),
  coverage: z.object({
    contractsIn: z.number().int().nonnegative(),
    contractsUsed: z.number().int().nonnegative(),
    contractsSkipped: z.number().int().nonnegative(),
    skipReasons: z.record(z.string(), z.number().int().nonnegative()),
    nonNullGammaCount: z.number().int().nonnegative().optional(),
    usableGammaCount: z.number().int().nonnegative().optional(),
    nonNullGammaCoveragePct: z.number().finite().nonnegative().optional(),
    usableGammaCoveragePct: z.number().finite().nonnegative().optional(),
    suspectVendorGreeksCount: z.number().int().nonnegative().optional(),
  }),
  synthetic: z.boolean(),
});

export type BoundedWallLevel = z.infer<typeof BoundedWallLevel>;
export type BoundedGammaProviderSnapshot = z.infer<
  typeof BoundedGammaProviderSnapshot
>;
export type BoundedGammaStrikeRequest = z.infer<
  typeof BoundedGammaStrikeRequest
>;
