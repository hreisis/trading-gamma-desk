import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const AI_STUDY_BRIEFING_SCHEMA_VERSION = "0.2.0";
export const AI_STUDY_METHODOLOGY_ID = "ai_study_briefing_v1";
export const AI_STUDY_METHODOLOGY_VERSION = "0.2.0";

export const AiStudyInputStatus = z.enum([
  "available",
  "unavailable",
  "fixture",
  "partial",
]);

export const AiStudyInputFreshness = z.enum([
  "live",
  "cached",
  "fixture",
  "stale",
  "unavailable",
]);

export const AiStudyInputProvenance = z.object({
  id: z.enum([
    "macro",
    "catalysts",
    "gamma_structure",
    "market_quotes",
  ]),
  status: AiStudyInputStatus,
  sourceLabel: z.string().min(1),
  note: z.string().optional(),
  provider: z.string().optional(),
  sessionDate: IsoDate.nullable().optional(),
  fetchedAt: IsoDateTime.nullable().optional(),
  freshness: AiStudyInputFreshness.optional(),
});

export const AiStudyClaim = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1).max(8),
});

export const AiStudyScenarios = z.object({
  bull: AiStudyClaim,
  base: AiStudyClaim,
  bear: AiStudyClaim,
});

export const AiStudyReport = z.object({
  marketRegime: AiStudyClaim,
  mainDrivers: z.array(AiStudyClaim).min(1).max(6),
  keyLevelsStructure: z.array(AiStudyClaim).min(1).max(8),
  upcomingRisks: z.array(AiStudyClaim).min(1).max(8),
  scenarios: AiStudyScenarios,
});

export const AiStudySessionAlignment = z.object({
  targetSessionDate: IsoDate.nullable(),
  aligned: z.boolean(),
  conflicts: z.array(z.string().min(1)),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      sessionDate: IsoDate.nullable(),
      fetchedAt: IsoDateTime.nullable(),
      freshness: AiStudyInputFreshness,
      provider: z.string().min(1),
    }),
  ),
});

export const AiStudyLlmUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

export const AiStudyGroundingResult = z.object({
  citationsValid: z.boolean(),
  numbersValid: z.boolean(),
  prohibitedLanguageDetected: z.boolean(),
  errors: z.array(z.string().min(1)),
});

export const AiStudyBriefingStatus = z.enum([
  "ready",
  "partial",
  "unavailable",
  "error",
  "synthetic_demo",
  "session_conflict",
]);

export const AiStudyViewMode = z.enum(["current", "historical"]);

export const AiStudyMarketStatus = z.enum([
  "regular_session_open",
  "premarket",
  "after_hours",
  "closed",
  "weekend",
  "holiday",
]);

export const AiStudyBriefing = z.object({
  kind: z.literal("AiStudyBriefing"),
  schemaVersion: z.literal(AI_STUDY_BRIEFING_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  sessionDate: IsoDate.nullable(),
  mode: AiStudyViewMode,
  marketStatus: AiStudyMarketStatus,
  timezone: z.literal("America/New_York"),
  status: AiStudyBriefingStatus,
  message: z.string().min(1),
  provider: z.enum(["openai", "rule_based", "synthetic_demo", "unavailable"]),
  model: z.string().nullable(),
  methodologyId: z.literal(AI_STUDY_METHODOLOGY_ID),
  methodologyVersion: z.literal(AI_STUDY_METHODOLOGY_VERSION),
  inputs: z.array(AiStudyInputProvenance),
  sessionAlignment: AiStudySessionAlignment.nullable(),
  usage: AiStudyLlmUsage.nullable(),
  grounding: AiStudyGroundingResult.nullable(),
  report: AiStudyReport.nullable(),
});

export const AiStudyNarratorRawOutput = AiStudyReport;

export type AiStudyBriefing = z.infer<typeof AiStudyBriefing>;
export type AiStudyViewMode = z.infer<typeof AiStudyViewMode>;
export type AiStudyMarketStatus = z.infer<typeof AiStudyMarketStatus>;
export type AiStudyReport = z.infer<typeof AiStudyReport>;
export type AiStudyClaim = z.infer<typeof AiStudyClaim>;
export type AiStudyInputProvenance = z.infer<typeof AiStudyInputProvenance>;
export type AiStudySessionAlignment = z.infer<typeof AiStudySessionAlignment>;
export type AiStudyLlmUsage = z.infer<typeof AiStudyLlmUsage>;
export type AiStudyGroundingResult = z.infer<typeof AiStudyGroundingResult>;
export type AiStudyNarratorRawOutput = z.infer<typeof AiStudyNarratorRawOutput>;
