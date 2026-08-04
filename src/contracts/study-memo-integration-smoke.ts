import { z } from "zod";
import { IsoDateTime } from "./common";
import { StudyMemoValidation } from "./study-memo";

export const STUDY_MEMO_INTEGRATION_SMOKE_SCHEMA_VERSION = "0.1.0";

export const StudyMemoIntegrationOverallStatus = z.enum([
  "passed",
  "partial",
  "unavailable",
  "failed",
]);

export const SanitizedMemoBullet = z.object({
  id: z.string().min(1),
  kind: z.enum(["evidence", "inference", "limitations", "unknowns"]),
  textPreview: z.string().max(240),
  bundleFieldPaths: z.array(z.string().min(1)).min(1),
});

export const StudyMemoSectionCounts = z.object({
  evidence: z.number().int().nonnegative(),
  inference: z.number().int().nonnegative(),
  limitations: z.number().int().nonnegative(),
  unknowns: z.number().int().nonnegative(),
});

export const SanitizedStudyMemoSummary = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  headline: z.string().min(1),
  sectionCounts: StudyMemoSectionCounts,
  bullets: z.array(SanitizedMemoBullet),
  validation: StudyMemoValidation,
});

export const StudyMemoIntegrationSmokeReport = z.object({
  kind: z.literal("StudyMemoIntegrationSmokeReport"),
  schemaVersion: z.literal(STUDY_MEMO_INTEGRATION_SMOKE_SCHEMA_VERSION),
  runId: z.string().min(1),
  mode: z.enum(["live", "dry-run"]),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime,
  sessionDate: z.string().min(1),
  bundlePath: z.string().min(1),
  bundleId: z.string().min(1),
  overallStatus: StudyMemoIntegrationOverallStatus,
  memoSource: z.enum(["abstained", "openai", "rule_based_fallback"]),
  provider: z.string().min(1),
  model: z.string().min(1),
  memoWritten: z.boolean(),
  outPath: z.string().optional(),
  fallbackReason: z.string().optional(),
  groundingChecks: z.record(z.string(), z.boolean()),
  errors: z.array(z.string()),
  notes: z.array(z.string()),
  memo: SanitizedStudyMemoSummary,
});

export type StudyMemoIntegrationOverallStatus = z.infer<
  typeof StudyMemoIntegrationOverallStatus
>;
export type StudyMemoSectionCounts = z.infer<typeof StudyMemoSectionCounts>;
export type SanitizedStudyMemoSummary = z.infer<
  typeof SanitizedStudyMemoSummary
>;
export type StudyMemoIntegrationSmokeReport = z.infer<
  typeof StudyMemoIntegrationSmokeReport
>;
