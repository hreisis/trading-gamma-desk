import { z } from "zod";
import { IsoDateTime } from "./common";

export const AI_BRIEF_SCHEMA_VERSION = "0.1.0";

export const OfficialAiBriefStatus = z.enum([
  "complete",
  "partial",
  "rejected",
  "unavailable",
]);

export const AiBriefBullet = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  factIds: z.array(z.string().min(1)).min(1),
});

export const AiBriefValidation = z.object({
  schemaValid: z.boolean(),
  citationsValid: z.boolean(),
  numbersValid: z.boolean(),
  prohibitedInferenceDetected: z.boolean(),
  errors: z.array(z.string()),
});

/**
 * Evidence-grounded LLM narrative brief (M2-3C).
 * Stored separately from deterministic OfficialBrief — never overwrites grounding.
 */
export const OfficialAiBrief = z.object({
  schemaVersion: z.literal(AI_BRIEF_SCHEMA_VERSION),
  id: z.string().min(1),
  inputBriefId: z.string().min(1),
  documentId: z.string().min(1),
  documentContentHash: z.string().min(1),
  extractorVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  generatedAt: IsoDateTime,
  status: OfficialAiBriefStatus,
  headline: z.string().min(1),
  bullets: z.array(AiBriefBullet),
  limitations: z.array(z.string()),
  validation: AiBriefValidation,
  synthetic: z.boolean(),
});

/** Strict JSON schema fragment returned by the model (before local wrap). */
export const AiNarratorOutput = z.object({
  headline: z.string().min(1),
  bullets: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        factIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(2)
    .max(4),
  limitations: z.array(z.string()),
});

export type OfficialAiBrief = z.infer<typeof OfficialAiBrief>;
export type OfficialAiBriefStatus = z.infer<typeof OfficialAiBriefStatus>;
export type AiBriefBullet = z.infer<typeof AiBriefBullet>;
export type AiBriefValidation = z.infer<typeof AiBriefValidation>;
export type AiNarratorOutput = z.infer<typeof AiNarratorOutput>;
