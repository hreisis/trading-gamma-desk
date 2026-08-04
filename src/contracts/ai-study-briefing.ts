import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const AI_STUDY_BRIEFING_SCHEMA_VERSION = "0.1.0";
export const AI_STUDY_METHODOLOGY_ID = "ai_study_briefing_v1";
export const AI_STUDY_METHODOLOGY_VERSION = "0.1.0";

export const AiStudyInputStatus = z.enum([
  "available",
  "unavailable",
  "fixture",
  "partial",
]);

export const AiStudyInputProvenance = z.object({
  id: z.enum([
    "macro",
    "market_temperature",
    "catalysts",
    "gamma_structure",
    "market_quotes",
    "historical_study",
  ]),
  status: AiStudyInputStatus,
  sourceLabel: z.string().min(1),
  note: z.string().optional(),
});

export const AiStudyScenarios = z.object({
  bull: z.string().min(1),
  base: z.string().min(1),
  bear: z.string().min(1),
});

export const AiStudyReport = z.object({
  marketRegime: z.string().min(1),
  mainDrivers: z.array(z.string().min(1)).min(1).max(6),
  keyLevelsStructure: z.array(z.string().min(1)).min(1).max(8),
  upcomingRisks: z.array(z.string().min(1)).min(1).max(8),
  scenarios: AiStudyScenarios,
});

export const AiStudyBriefingStatus = z.enum([
  "ready",
  "unavailable",
  "error",
  "synthetic_demo",
]);

export const AiStudyBriefing = z.object({
  kind: z.literal("AiStudyBriefing"),
  schemaVersion: z.literal(AI_STUDY_BRIEFING_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  sessionDate: IsoDate.nullable(),
  status: AiStudyBriefingStatus,
  message: z.string().min(1),
  provider: z.enum(["openai", "synthetic_demo", "unavailable"]),
  model: z.string().nullable(),
  methodologyId: z.literal(AI_STUDY_METHODOLOGY_ID),
  methodologyVersion: z.literal(AI_STUDY_METHODOLOGY_VERSION),
  inputs: z.array(AiStudyInputProvenance),
  report: AiStudyReport.nullable(),
});

export const AiStudyNarratorRawOutput = AiStudyReport;

export type AiStudyBriefing = z.infer<typeof AiStudyBriefing>;
export type AiStudyReport = z.infer<typeof AiStudyReport>;
export type AiStudyInputProvenance = z.infer<typeof AiStudyInputProvenance>;
export type AiStudyNarratorRawOutput = z.infer<typeof AiStudyNarratorRawOutput>;
