import { z } from "zod";
import { IsoDateTime } from "./common";
import { DocumentReleaseFamily } from "./official-document";

export const OFFICIAL_BRIEF_SCHEMA_VERSION = "0.1.0";

export const OfficialBriefStatus = z.enum([
  "complete",
  "partial",
  "unavailable",
]);

export const BriefFactType = z.enum([
  "policy_action",
  "reported_value",
  "comparison",
  "revision",
  "vote",
]);

export const BriefFactEvidence = z.object({
  documentId: z.string().min(1),
  contentHash: z.string().min(1),
  excerpt: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
});

export const BriefFactValue = z.object({
  metric: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  period: z.string().min(1).optional(),
});

export const BriefFactCrossCheck = z.object({
  status: z.enum(["matched", "mismatch"]),
  structuredMetric: z.string().min(1),
  structuredActual: z.number(),
  tolerance: z.number().nonnegative(),
});

export const BriefFact = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  text: z.string().min(1),
  factType: BriefFactType,
  values: z.array(BriefFactValue).optional(),
  evidence: BriefFactEvidence,
  crossCheck: BriefFactCrossCheck.optional(),
});

/**
 * Evidence-grounded deterministic brief (M2-3B).
 * Rule-based facts only — never LLM prose, hawkish/dovish, or trade advice.
 */
export const OfficialBrief = z.object({
  schemaVersion: z.literal(OFFICIAL_BRIEF_SCHEMA_VERSION),
  id: z.string().min(1),
  documentId: z.string().min(1),
  documentContentHash: z.string().min(1),
  extractorVersion: z.string().min(1),
  releaseFamily: DocumentReleaseFamily,
  referencePeriod: z.string().min(1).optional(),
  generatedAt: IsoDateTime,
  status: OfficialBriefStatus,
  headline: z.string().min(1),
  facts: z.array(BriefFact),
  omissions: z.array(z.string()),
  warnings: z.array(z.string()),
  synthetic: z.boolean(),
});

export type OfficialBrief = z.infer<typeof OfficialBrief>;
export type OfficialBriefStatus = z.infer<typeof OfficialBriefStatus>;
export type BriefFact = z.infer<typeof BriefFact>;
export type BriefFactType = z.infer<typeof BriefFactType>;
export type BriefFactEvidence = z.infer<typeof BriefFactEvidence>;
export type BriefFactValue = z.infer<typeof BriefFactValue>;
export type BriefFactCrossCheck = z.infer<typeof BriefFactCrossCheck>;
