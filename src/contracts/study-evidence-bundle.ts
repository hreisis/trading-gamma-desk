import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import { ForwardHorizon } from "./study-outcome";
import {
  HorizonOutcomeAggregate,
  SimilarRegimeMatchCriteria,
  StudyMatchProfile,
} from "./similar-regime-study";

export const STUDY_EVIDENCE_BUNDLE_SCHEMA_VERSION = "0.1.0";
export const STUDY_EVIDENCE_BUNDLE_METHODOLOGY_ID = "study_evidence_bundle_v1";
export const STUDY_EVIDENCE_BUNDLE_METHODOLOGY_VERSION = "0.1.0";

/** Default primary horizon for overall evidence status classification. */
export const DEFAULT_EVIDENCE_PRIMARY_HORIZON = "5D" as const;

/** Deterministic thresholds — documented in builder; not calibrated probabilities. */
export const EVIDENCE_STATUS_THRESHOLDS = {
  positiveRateSupportedMin: 0.6,
  positiveRateNotSupportedMax: 0.4,
} as const;

export const EvidenceStatus = z.enum([
  "supported",
  "mixed",
  "not_supported",
  "insufficient_evidence",
]);

export const CohortQualityStatus = z.enum(["empty", "thin", "adequate"]);

export const StudyEvidenceSourceKind = z.enum([
  "similar_regime_study",
  "study_definition",
  "daily_research_archive",
  "forward_outcome",
]);

export const StudyEvidenceSourceRef = z.object({
  kind: StudyEvidenceSourceKind,
  refId: z.string().min(1),
  relativePath: z.string().min(1).optional(),
  schemaVersion: z.string().min(1).optional(),
});

export const EvidenceStatusBasis = z.object({
  ruleId: z.string().min(1),
  primaryHorizon: ForwardHorizon,
  medianReturn: z.number().finite().nullable(),
  meanReturn: z.number().finite().nullable(),
  positiveRate: z.number().finite().nullable(),
  reasons: z.array(z.string().min(1)).min(1),
});

export const HorizonEvidence = z.object({
  horizon: ForwardHorizon,
  aggregate: HorizonOutcomeAggregate,
  evidenceStatus: EvidenceStatus,
  statusBasis: EvidenceStatusBasis,
});

export const StudyEvidenceBundle = z.object({
  kind: z.literal("StudyEvidenceBundle"),
  schemaVersion: z.literal(STUDY_EVIDENCE_BUNDLE_SCHEMA_VERSION),
  bundleId: z.string().min(1),
  studyId: z.string().min(1),
  computedAt: IsoDateTime,
  methodologyId: z.literal(STUDY_EVIDENCE_BUNDLE_METHODOLOGY_ID),
  methodologyVersion: z.literal(STUDY_EVIDENCE_BUNDLE_METHODOLOGY_VERSION),
  queryContext: z.object({
    studyId: z.string().min(1),
    sessionDate: IsoDate,
    symbol: z.string().min(1).optional(),
    matchProfile: StudyMatchProfile,
  }),
  matchCriteria: SimilarRegimeMatchCriteria,
  cohortQuality: z.object({
    status: CohortQualityStatus,
    matchedStudyCount: z.number().int().nonnegative(),
    rejectedStudyCount: z.number().int().nonnegative(),
    matchedStudyIds: z.array(z.string().min(1)),
    differentFactorCount: z.number().int().nonnegative(),
    primaryHorizonMatureCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    reasons: z.array(z.string().min(1)),
  }),
  primaryHorizon: ForwardHorizon,
  horizonEvidence: z.object({
    d1: HorizonEvidence,
    d5: HorizonEvidence,
    d20: HorizonEvidence,
  }),
  evidenceStatus: EvidenceStatus,
  statusBasis: EvidenceStatusBasis,
  limitations: z.array(z.string()),
  sources: z.array(StudyEvidenceSourceRef).min(1),
});

export function buildEvidenceBundleId(studyId: string): string {
  return `evidence|${studyId}|${STUDY_EVIDENCE_BUNDLE_METHODOLOGY_VERSION}`;
}

export type EvidenceStatus = z.infer<typeof EvidenceStatus>;
export type CohortQualityStatus = z.infer<typeof CohortQualityStatus>;
export type StudyEvidenceSourceRef = z.infer<typeof StudyEvidenceSourceRef>;
export type EvidenceStatusBasis = z.infer<typeof EvidenceStatusBasis>;
export type HorizonEvidence = z.infer<typeof HorizonEvidence>;
export type StudyEvidenceBundle = z.infer<typeof StudyEvidenceBundle>;
