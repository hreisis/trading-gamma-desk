import { z } from "zod";
import { IsoDate } from "./common";
import { EvidenceStatus } from "./study-evidence-bundle";
import { StructureConditionState } from "./market-structure-state-v2";
import { StudyMemoBullet, StudyMemoStatus } from "./study-memo";

export const DECISION_SURFACE_VIEW_SCHEMA_VERSION = "0.1.0";

export const DecisionSurfaceStatus = z.enum([
  "ready",
  "missing_date",
  "date_unavailable",
  "partial",
]);

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
});

export const DecisionResearchSection = z.object({
  memoHeadline: z.string().min(1),
  memoStatus: StudyMemoStatus,
  memoProvider: z.string().min(1),
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
  observe: DecisionObserveSummary.optional(),
  research: DecisionResearchSection.optional(),
  policy: PublicPolicySlot.optional(),
  stance: DeskStance.optional(),
});

export type DecisionSurfaceStatus = z.infer<typeof DecisionSurfaceStatus>;
export type PublicPolicySlot = z.infer<typeof PublicPolicySlot>;
export type DeskStance = z.infer<typeof DeskStance>;
export type DecisionObserveSummary = z.infer<typeof DecisionObserveSummary>;
export type DecisionResearchSection = z.infer<typeof DecisionResearchSection>;
export type DecisionSurfaceView = z.infer<typeof DecisionSurfaceView>;
