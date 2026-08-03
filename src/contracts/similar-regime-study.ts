import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import { ForwardHorizon } from "./study-outcome";

export const SIMILAR_REGIME_STUDY_SCHEMA_VERSION = "0.1.0";
export const SIMILAR_REGIME_STUDY_METHODOLOGY_ID = "similar_regime_study_v1";
export const SIMILAR_REGIME_STUDY_METHODOLOGY_VERSION = "0.1.0";

export const STUDY_MATCH_PROFILE_SCHEMA_VERSION = "0.1.0";

/** Explicit PIT match fields — macro / catalyst / gamma only; never from outcomes. */
export const StudyMatchFactorKey = z.enum([
  "macro_regime",
  "gamma_regime",
  "structure_status",
  "bounded_gamma_availability",
  "bounded_scope",
  "catalyst_ids",
]);

export const MatchFieldValue = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    value: z.string().min(1),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
]);

export const StudyMatchProfile = z.object({
  kind: z.literal("StudyMatchProfile"),
  schemaVersion: z.literal(STUDY_MATCH_PROFILE_SCHEMA_VERSION),
  studyId: z.string().min(1),
  sessionDate: IsoDate,
  fields: z.record(StudyMatchFactorKey, MatchFieldValue),
});

export const SimilarRegimeMatchCriteria = z.object({
  factors: z.array(StudyMatchFactorKey).min(1),
  /** Exclude the query study from the matched sample. */
  excludeQueryStudy: z.boolean().default(true),
  /** Minimum mature outcomes per horizon before aggregate is available. */
  minMatureSampleSize: z.number().int().positive().default(1),
});

export const HorizonOutcomeAggregate = z.object({
  horizon: ForwardHorizon,
  matureCount: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  status: z.enum(["available", "insufficient_data"]),
  meanReturn: z.number().finite().nullable(),
  medianReturn: z.number().finite().nullable(),
  /** Fraction of mature returns strictly > 0, in [0, 1]. */
  positiveRate: z.number().finite().nullable(),
  meanMfe: z.number().finite().nullable(),
  medianMfe: z.number().finite().nullable(),
  meanMae: z.number().finite().nullable(),
  medianMae: z.number().finite().nullable(),
  reason: z.string().optional(),
});

export const SimilarRegimeStudy = z.object({
  kind: z.literal("SimilarRegimeStudy"),
  schemaVersion: z.literal(SIMILAR_REGIME_STUDY_SCHEMA_VERSION),
  studyId: z.string().min(1),
  computedAt: IsoDateTime,
  methodologyId: z.literal(SIMILAR_REGIME_STUDY_METHODOLOGY_ID),
  methodologyVersion: z.literal(SIMILAR_REGIME_STUDY_METHODOLOGY_VERSION),
  queryProfile: StudyMatchProfile,
  matchCriteria: SimilarRegimeMatchCriteria,
  matchedStudyIds: z.array(z.string().min(1)),
  rejected: z.array(
    z.object({
      studyId: z.string().min(1),
      reasons: z.array(z.string().min(1)).min(1),
    }),
  ),
  matchedFactors: z.array(StudyMatchFactorKey).min(1),
  differentFactors: z.array(
    z.object({
      factor: StudyMatchFactorKey,
      distinctValues: z.array(z.string().min(1)).min(1),
    }),
  ),
  aggregates: z.object({
    d1: HorizonOutcomeAggregate,
    d5: HorizonOutcomeAggregate,
    d20: HorizonOutcomeAggregate,
  }),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
});

export type StudyMatchFactorKey = z.infer<typeof StudyMatchFactorKey>;
export type MatchFieldValue = z.infer<typeof MatchFieldValue>;
export type StudyMatchProfile = z.infer<typeof StudyMatchProfile>;
export type SimilarRegimeMatchCriteria = z.infer<typeof SimilarRegimeMatchCriteria>;
export type HorizonOutcomeAggregate = z.infer<typeof HorizonOutcomeAggregate>;
export type SimilarRegimeStudy = z.infer<typeof SimilarRegimeStudy>;
