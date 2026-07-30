import { z } from "zod";
import { IsoDateTime } from "./common";

export const INTEGRATION_SMOKE_SCHEMA_VERSION = "0.1.0";

export const IntegrationSmokeStageStatus = z.enum([
  "passed",
  "skipped_no_eligible_input",
  "skipped_dependency_unavailable",
  "awaiting_credentials",
  "awaiting_valid_credentials",
  "awaiting_live_smoke",
  "unavailable",
  "failed",
]);

export const IntegrationSmokeOverallStatus = z.enum([
  "passed",
  "partial",
  "unavailable",
  "failed",
]);

export const IntegrationSmokeStageReport = z.object({
  stage: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  feed: z.string().optional(),
  status: IntegrationSmokeStageStatus,
  attemptedCount: z.number().int().nonnegative(),
  validatedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  cachePreserved: z.boolean(),
  errorCodes: z.array(z.string()),
  startedAt: IsoDateTime.optional(),
  completedAt: IsoDateTime.optional(),
});

export const CatalystIntegrationSmokeReport = z.object({
  schemaVersion: z.literal(INTEGRATION_SMOKE_SCHEMA_VERSION),
  kind: z.literal("CatalystIntegrationSmokeReport"),
  runId: z.string().min(1),
  mode: z.enum(["live", "dry-run"]),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime,
  overallStatus: IntegrationSmokeOverallStatus,
  maxEvents: z.number().int().positive(),
  liveOptIn: z.boolean(),
  updateCache: z.boolean(),
  notes: z.array(z.string()),
  stages: z.array(IntegrationSmokeStageReport),
});

export type CatalystIntegrationSmokeReport = z.infer<
  typeof CatalystIntegrationSmokeReport
>;
export type IntegrationSmokeStageReport = z.infer<
  typeof IntegrationSmokeStageReport
>;
export type IntegrationSmokeStageStatus = z.infer<
  typeof IntegrationSmokeStageStatus
>;
export type IntegrationSmokeOverallStatus = z.infer<
  typeof IntegrationSmokeOverallStatus
>;
