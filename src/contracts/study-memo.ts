import { z } from "zod";
import { IsoDateTime } from "./common";

export const STUDY_MEMO_SCHEMA_VERSION = "0.1.0";
export const STUDY_MEMO_METHODOLOGY_ID = "study_memo_v1";
export const STUDY_MEMO_METHODOLOGY_VERSION = "0.1.0";

export const StudyMemoStatus = z.enum([
  "complete",
  "partial",
  "abstained",
  "rejected",
  "unavailable",
]);

export const StudyMemoSectionKind = z.enum([
  "evidence",
  "inference",
  "limitations",
  "unknowns",
]);

export const StudyMemoBullet = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Dot paths into the StudyEvidenceBundle, prefixed with `bundle.`. */
  bundleFieldPaths: z.array(z.string().min(1)).min(1),
});

export const StudyMemoValidation = z.object({
  schemaValid: z.boolean(),
  citationsValid: z.boolean(),
  numbersValid: z.boolean(),
  prohibitedInferenceDetected: z.boolean(),
  errors: z.array(z.string()),
});

/**
 * Constrained LLM study memo (M6-1).
 * Input = StudyEvidenceBundle only; never embeds raw prices or new computed stats.
 */
export const StudyMemo = z.object({
  kind: z.literal("StudyMemo"),
  schemaVersion: z.literal(STUDY_MEMO_SCHEMA_VERSION),
  id: z.string().min(1),
  bundleId: z.string().min(1),
  bundleSchemaVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  generatedAt: IsoDateTime,
  status: StudyMemoStatus,
  headline: z.string().min(1),
  evidence: z.array(StudyMemoBullet),
  inference: z.array(StudyMemoBullet),
  limitations: z.array(StudyMemoBullet),
  unknowns: z.array(StudyMemoBullet),
  validation: StudyMemoValidation,
  synthetic: z.boolean(),
});

/** Strict JSON schema fragment returned by the model (before local wrap). */
export const StudyMemoNarratorRawBullet = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Allowed citation IDs from the deterministic input catalog only. */
  citationIds: z.array(z.string().min(1)).min(1),
});

export const StudyMemoNarratorRawOutput = z.object({
  evidence: z.array(StudyMemoNarratorRawBullet).min(1),
  inference: z.array(StudyMemoNarratorRawBullet),
  limitations: z.array(StudyMemoNarratorRawBullet),
  unknowns: z.array(StudyMemoNarratorRawBullet),
});

export const StudyMemoNarratorOutput = z.object({
  headline: z.string().min(1),
  evidence: z.array(StudyMemoBullet).min(1),
  inference: z.array(StudyMemoBullet),
  limitations: z.array(StudyMemoBullet),
  unknowns: z.array(StudyMemoBullet),
});

export type StudyMemoStatus = z.infer<typeof StudyMemoStatus>;
export type StudyMemoSectionKind = z.infer<typeof StudyMemoSectionKind>;
export type StudyMemoBullet = z.infer<typeof StudyMemoBullet>;
export type StudyMemoValidation = z.infer<typeof StudyMemoValidation>;
export type StudyMemo = z.infer<typeof StudyMemo>;
export type StudyMemoNarratorRawBullet = z.infer<typeof StudyMemoNarratorRawBullet>;
export type StudyMemoNarratorRawOutput = z.infer<typeof StudyMemoNarratorRawOutput>;
export type StudyMemoNarratorOutput = z.infer<typeof StudyMemoNarratorOutput>;
