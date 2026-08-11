import { z } from "zod";
import { IsoDateTime } from "./common";

export const BREADTH_RISK_OVERLAY_SCHEMA_VERSION = "0.1.0" as const;

export const BreadthRiskOverlayDataStatus = z.enum([
  "available",
  "insufficient_history",
  "unavailable",
]);

export const BreadthRiskOverlayDiagnostics = z.object({
  eligibleSessionCount: z.number().int().nonnegative(),
  excludedLegacy: z.number().int().nonnegative(),
  excludedPartial: z.number().int().nonnegative(),
  excludedStaleSnapshot: z.number().int().nonnegative(),
  excludedStaleUniverse: z.number().int().nonnegative(),
  excludedUnavailableMetrics: z.number().int().nonnegative(),
});

export const BreadthRiskOverlayResult = z.object({
  kind: z.literal("BreadthRiskOverlay"),
  schemaVersion: z.literal(BREADTH_RISK_OVERLAY_SCHEMA_VERSION),
  regime: z.null(),
  riskCap: z.null(),
  sessionCount: z.number().int().nonnegative(),
  asOf: IsoDateTime.nullable(),
  dataStatus: BreadthRiskOverlayDataStatus,
  diagnostics: BreadthRiskOverlayDiagnostics,
});

export type BreadthRiskOverlayDataStatus = z.infer<
  typeof BreadthRiskOverlayDataStatus
>;
export type BreadthRiskOverlayDiagnostics = z.infer<
  typeof BreadthRiskOverlayDiagnostics
>;
export type BreadthRiskOverlayResult = z.infer<typeof BreadthRiskOverlayResult>;
