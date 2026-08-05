import { z } from "zod";
import { IsoDate } from "./common";
import { EvidenceStatus, CohortQualityStatus } from "./study-evidence-bundle";
import { ForwardHorizon } from "./study-outcome";
import { StructureConditionState } from "./market-structure-state-v2";
import { StudyMatchFactorKey } from "./similar-regime-study";
import {
  StudyMemoBullet,
  StudyMemoStatus,
} from "./study-memo";

export const DECISION_SURFACE_VIEW_SCHEMA_VERSION = "0.3.0";

export const DecisionSurfaceStatus = z.enum([
  "ready",
  "missing_date",
  "date_unavailable",
  "partial",
  "artifacts_missing",
  "integrity_failed",
]);

export const EvidenceStrengthDisplay = z.enum([
  "insufficient",
  "preliminary",
  "limited",
  "adequate",
]);

export const ArtifactKind = z.enum([
  "driver",
  "structure",
  "evidence_bundle",
  "study_memo",
  "pipeline_run",
]);

export const ArtifactSeverity = z.enum([
  "missing",
  "invalid",
  "mismatched",
  "stale",
]);

export const ArtifactIntegrityIssue = z.object({
  artifact: ArtifactKind,
  severity: ArtifactSeverity,
  message: z.string().min(1),
  path: z.string().optional(),
});

export const HorizonEvidenceDisplay = z.object({
  horizon: ForwardHorizon,
  dataStatus: z.enum(["available", "insufficient_data"]),
  evidenceStatus: EvidenceStatus,
  matureCount: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  meanReturn: z.string(),
  medianReturn: z.string(),
  positiveRate: z.string(),
  meanMfe: z.string(),
  meanMae: z.string(),
  unavailableReason: z.string().optional(),
});

export const DecisionEvidenceSummary = z.object({
  bundleId: z.string().min(1),
  evidenceStatus: EvidenceStatus,
  evidenceStatusLabel: z.string().min(1),
  evidenceStatusNote: z.string(),
  strengthDisplay: EvidenceStrengthDisplay,
  strengthSummary: z.string().min(1),
  primaryHorizon: ForwardHorizon,
  cohortMatchedCount: z.number().int().nonnegative(),
  cohortMatureCount: z.number().int().nonnegative(),
  cohortQualityStatus: CohortQualityStatus,
  horizons: z.object({
    d1: HorizonEvidenceDisplay,
    d5: HorizonEvidenceDisplay,
    d20: HorizonEvidenceDisplay,
  }),
  limitations: z.array(z.string()),
  cohortWarnings: z.array(z.string()),
  statusBasisRuleId: z.string().min(1),
});

export const PublicPolicySlotStatus = z.enum(["unavailable"]);

/** Public-safe policy placeholder — real M7 evaluator lives in private repo. */
export const PublicPolicySlot = z.object({
  kind: z.literal("PublicPolicySlot"),
  schemaVersion: z.literal("0.1.0"),
  status: PublicPolicySlotStatus,
  sessionDate: IsoDate,
  message: z.string().min(1),
  synthetic: z.literal(true),
});

export const DeskStance = z.object({
  kind: z.literal("DeskStance"),
  schemaVersion: z.literal("0.1.0"),
  sessionDate: IsoDate,
  summary: z.string().min(1),
  evidenceStatus: EvidenceStatus,
  structureCondition: StructureConditionState.nullable(),
  /** Explicit marker — not an order, allocation, or probability. */
  nonTrade: z.literal(true),
});

export const DecisionObserveSummary = z.object({
  sessionDate: IsoDate,
  driverRegime: z.string().min(1),
  driverLabel: z.string().min(1),
  confidenceDisplay: z.string().min(1),
  driverInterpretation: z.string().min(1),
  catalystHeadline: z.string().min(1),
  catalystDetail: z.string().optional(),
  structureSummary: z.string().optional(),
  structureCondition: StructureConditionState.optional(),
  structureUnavailableReason: z.string().optional(),
  marketQuotesHeadline: z.string().optional(),
  marketQuotesDetail: z.string().optional(),
});

export const EvidenceDrillDownLane = z.enum([
  "deterministic",
  "inference",
  "limitations",
  "unknowns",
]);

export const MatchFieldDisplay = z.object({
  factor: StudyMatchFactorKey,
  queryValue: z.string(),
  status: z.enum(["available", "unavailable"]),
  unavailableReason: z.string().optional(),
});

export const MatchCriteriaDisplay = z.object({
  factors: z.array(StudyMatchFactorKey),
  excludeQueryStudy: z.boolean(),
  minMatureSampleSize: z.number().int().positive(),
});

export const DifferentFactorDisplay = z.object({
  factor: StudyMatchFactorKey,
  distinctValues: z.array(z.string().min(1)),
});

export const SimilarityDetailDisplay = z.object({
  matchedFactors: z.array(StudyMatchFactorKey),
  differentFactors: z.array(DifferentFactorDisplay),
  rejectedStudyCount: z.number().int().nonnegative(),
  statusBasisReasons: z.array(z.string()),
  statusBasisRuleId: z.string().min(1),
});

export const HorizonEvidenceDrillDown = HorizonEvidenceDisplay.extend({
  medianMfe: z.string(),
  medianMae: z.string(),
  statusBasisReasons: z.array(z.string()),
});

export const PeerHorizonOutcomeDisplay = z.object({
  horizon: ForwardHorizon,
  maturity: z.enum(["mature", "immature", "unavailable", "unknown"]),
  return: z.string(),
  mfe: z.string(),
  mae: z.string(),
  unavailableReason: z.string().optional(),
});

export const MatchedSessionDisplay = z.object({
  studyId: z.string().min(1),
  sessionDate: IsoDate,
  matchFields: z.array(MatchFieldDisplay),
  horizons: z.array(PeerHorizonOutcomeDisplay).length(3),
  missingDataNotes: z.array(z.string()),
  profileStatus: z.enum(["available", "partial", "unavailable"]),
  outcomeStatus: z.enum(["available", "partial", "unavailable"]),
});

export const CitationFieldPreview = z.object({
  path: z.string().min(1),
  displayValue: z.string(),
  resolved: z.boolean(),
});

export const MemoBulletDrillDown = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  lane: EvidenceDrillDownLane,
  citations: z.array(CitationFieldPreview).min(1),
});

export const DecisionEvidenceDrillDown = z.object({
  queryMatchFields: z.array(MatchFieldDisplay),
  matchCriteria: MatchCriteriaDisplay,
  similarity: SimilarityDetailDisplay,
  horizons: z.object({
    d1: HorizonEvidenceDrillDown,
    d5: HorizonEvidenceDrillDown,
    d20: HorizonEvidenceDrillDown,
  }),
  matchedSessions: z.array(MatchedSessionDisplay),
  bundleLimitations: z.array(z.string()),
  cohortUnknowns: z.array(z.string()),
  memoBullets: z.array(MemoBulletDrillDown),
});

export const DecisionResearchSection = z.object({
  evidenceSummary: DecisionEvidenceSummary,
  evidenceDrillDown: DecisionEvidenceDrillDown,
  memoHeadline: z.string().min(1),
  memoStatus: StudyMemoStatus,
  memoStatusLabel: z.string().min(1),
  memoSourceLabel: z.string().min(1),
  memoProvenanceLabel: z.string().min(1),
  memoProvider: z.string().min(1),
  memoModel: z.string().min(1),
  bundleId: z.string().min(1),
  evidence: z.array(StudyMemoBullet),
  inference: z.array(StudyMemoBullet),
  limitations: z.array(StudyMemoBullet),
  unknowns: z.array(StudyMemoBullet),
});

export const DecisionSurfaceView = z.object({
  kind: z.literal("DecisionSurfaceView"),
  schemaVersion: z.literal(DECISION_SURFACE_VIEW_SCHEMA_VERSION),
  status: DecisionSurfaceStatus,
  sessionDate: IsoDate.nullable(),
  isPublicDemo: z.boolean(),
  isSynthetic: z.boolean(),
  sourceLabel: z.string().min(1),
  errorMessage: z.string().optional(),
  artifactIssues: z.array(ArtifactIntegrityIssue),
  studyIntegrityOk: z.boolean(),
  observe: DecisionObserveSummary.optional(),
  research: DecisionResearchSection.optional(),
  policy: PublicPolicySlot.optional(),
  stance: DeskStance.optional(),
});

export type DecisionSurfaceStatus = z.infer<typeof DecisionSurfaceStatus>;
export type EvidenceStrengthDisplay = z.infer<typeof EvidenceStrengthDisplay>;
export type ArtifactIntegrityIssue = z.infer<typeof ArtifactIntegrityIssue>;
export type HorizonEvidenceDisplay = z.infer<typeof HorizonEvidenceDisplay>;
export type DecisionEvidenceSummary = z.infer<typeof DecisionEvidenceSummary>;
export type PublicPolicySlot = z.infer<typeof PublicPolicySlot>;
export type DeskStance = z.infer<typeof DeskStance>;
export type DecisionObserveSummary = z.infer<typeof DecisionObserveSummary>;
export type EvidenceDrillDownLane = z.infer<typeof EvidenceDrillDownLane>;
export type MatchFieldDisplay = z.infer<typeof MatchFieldDisplay>;
export type MatchCriteriaDisplay = z.infer<typeof MatchCriteriaDisplay>;
export type DifferentFactorDisplay = z.infer<typeof DifferentFactorDisplay>;
export type SimilarityDetailDisplay = z.infer<typeof SimilarityDetailDisplay>;
export type HorizonEvidenceDrillDown = z.infer<typeof HorizonEvidenceDrillDown>;
export type PeerHorizonOutcomeDisplay = z.infer<typeof PeerHorizonOutcomeDisplay>;
export type MatchedSessionDisplay = z.infer<typeof MatchedSessionDisplay>;
export type CitationFieldPreview = z.infer<typeof CitationFieldPreview>;
export type MemoBulletDrillDown = z.infer<typeof MemoBulletDrillDown>;
export type DecisionEvidenceDrillDown = z.infer<typeof DecisionEvidenceDrillDown>;
export type DecisionResearchSection = z.infer<typeof DecisionResearchSection>;
export type DecisionSurfaceView = z.infer<typeof DecisionSurfaceView>;
