import { z } from "zod";
import { IsoDateTime } from "./common";

export const CATALYST_UPDATE_MANIFEST_SCHEMA_VERSION = "0.1.0";

export const CatalystUpdateStageId = z.enum([
  "official_facts",
  "openai_official_brief",
  "market_context_4a",
  "reaction_4b",
  "openai_reaction_4c",
]);

export const CatalystUpdateStageStatus = z.enum([
  "passed",
  "skipped_up_to_date",
  "skipped_dependency_unavailable",
  "skipped_no_eligible_input",
  "awaiting_valid_credentials",
  "awaiting_live_smoke",
  "unavailable",
  "failed",
]);

export const CatalystUpdateOverallStatus = z.enum([
  "passed",
  "partial",
  "unavailable",
  "failed",
]);

export const CatalystUpdateStageManifest = z.object({
  stage: CatalystUpdateStageId,
  dependsOn: z.array(CatalystUpdateStageId),
  provider: z.string().optional(),
  model: z.string().optional(),
  feed: z.string().optional(),
  status: CatalystUpdateStageStatus,
  attemptedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  cachePreserved: z.boolean(),
  errorCodes: z.array(z.string()),
  startedAt: IsoDateTime.optional(),
  completedAt: IsoDateTime.optional(),
});

export const CatalystUpdateManifest = z.object({
  schemaVersion: z.literal(CATALYST_UPDATE_MANIFEST_SCHEMA_VERSION),
  kind: z.literal("CatalystUpdateManifest"),
  runId: z.string().min(1),
  mode: z.enum(["live", "dry-run"]),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime,
  overallStatus: CatalystUpdateOverallStatus,
  maxEvents: z.number().int().positive(),
  force: z.boolean(),
  notes: z.array(z.string()),
  stages: z.array(CatalystUpdateStageManifest),
});

export type CatalystUpdateManifest = z.infer<typeof CatalystUpdateManifest>;
export type CatalystUpdateStageManifest = z.infer<
  typeof CatalystUpdateStageManifest
>;
export type CatalystUpdateStageId = z.infer<typeof CatalystUpdateStageId>;
export type CatalystUpdateStageStatus = z.infer<
  typeof CatalystUpdateStageStatus
>;
export type CatalystUpdateOverallStatus = z.infer<
  typeof CatalystUpdateOverallStatus
>;
