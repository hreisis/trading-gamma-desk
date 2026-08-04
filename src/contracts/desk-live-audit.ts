import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const DESK_LIVE_AUDIT_SCHEMA_VERSION = "0.1.0";

export const DeskLiveAuditSourceRow = z.object({
  module: z.string().min(1),
  provider: z.string().min(1),
  sessionDate: IsoDate.nullable(),
  fetchedAt: IsoDateTime.nullable(),
  freshness: z.string().min(1),
  status: z.string().min(1),
  note: z.string().optional(),
});

export const DeskLiveAuditComparisonRow = z.object({
  field: z.string().min(1),
  module: z.string().min(1),
  displayed: z.union([z.string(), z.number(), z.null()]),
  providerInput: z.union([z.string(), z.number(), z.null()]),
  match: z.boolean(),
  note: z.string().optional(),
});

export const DeskLiveAuditReport = z.object({
  kind: z.literal("DeskLiveAuditReport"),
  schemaVersion: z.literal(DESK_LIVE_AUDIT_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  sessionDate: IsoDate.nullable(),
  overallStatus: z.enum(["ready", "partial", "failed", "blocked"]),
  sessionAlignment: z.object({
    aligned: z.boolean(),
    conflicts: z.array(z.string()),
  }),
  sources: z.array(DeskLiveAuditSourceRow),
  comparisons: z.array(DeskLiveAuditComparisonRow),
  aiStudy: z
    .object({
      status: z.string(),
      model: z.string().nullable(),
      usage: z
        .object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          totalTokens: z.number(),
          retryCount: z.number(),
          estimatedCostUsd: z.number(),
        })
        .nullable(),
      grounding: z
        .object({
          citationsValid: z.boolean(),
          numbersValid: z.boolean(),
          prohibitedLanguageDetected: z.boolean(),
          errors: z.array(z.string()),
        })
        .nullable(),
      sampleRegime: z.string().nullable(),
    })
    .nullable(),
  notes: z.array(z.string()),
});

export type DeskLiveAuditReport = z.infer<typeof DeskLiveAuditReport>;
export type DeskLiveAuditSourceRow = z.infer<typeof DeskLiveAuditSourceRow>;
export type DeskLiveAuditComparisonRow = z.infer<typeof DeskLiveAuditComparisonRow>;
