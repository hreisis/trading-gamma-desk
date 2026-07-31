import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const REPLAY_SCHEMA_VERSION = "0.1.0";
export const REPLAY_METHODOLOGY_ID = "pit_replay_v1";
export const REPLAY_METHODOLOGY_VERSION = "0.1.0";

export const ReplaySourceKind = z.enum([
  "macro",
  "market_structure",
  "catalyst_evidence",
]);

/**
 * Normalized stored artifact metadata for PIT selection.
 * Does not recompute source payloads — identity + availability only.
 */
export const ReplayMacroArtifact = z.object({
  kind: z.literal("ReplayMacroArtifact"),
  artifactId: z.string().min(1),
  /** When the macro artifact became available for observation. */
  availableAt: IsoDateTime,
  schemaVersion: z.string().min(1),
  methodologyVersion: z.string().min(1),
  signatureVersion: z.string().min(1),
  marketSessionDate: IsoDate,
  synthetic: z.boolean(),
  /** DominantDriver primaryRegime / fallback label for audit — not recomputed. */
  status: z.string().min(1),
  limitations: z.array(z.string()),
});

export const ReplayStructureArtifact = z.object({
  kind: z.literal("ReplayStructureArtifact"),
  artifactId: z.string().min(1),
  availableAt: IsoDateTime,
  schemaVersion: z.string().min(1),
  methodologyId: z.string().min(1),
  methodologyVersion: z.string().min(1),
  featureMethodologyId: z.string().min(1),
  featureMethodologyVersion: z.string().min(1),
  underlying: z.string().min(1),
  sessionDate: IsoDate,
  snapshotId: z.string().min(1),
  synthetic: z.boolean(),
  status: z.string().min(1),
  limitations: z.array(z.string()),
});

/**
 * Catalyst evidence artifact. Eligible only at/after `publishedAt`
 * (explicit release/publication time — never inferred from wall clock).
 */
export const ReplayCatalystArtifact = z.object({
  kind: z.literal("ReplayCatalystArtifact"),
  artifactId: z.string().min(1),
  publishedAt: IsoDateTime,
  schemaVersion: z.string().min(1),
  catalystId: z.string().min(1),
  synthetic: z.boolean(),
  status: z.string().min(1),
  limitations: z.array(z.string()),
});

export const ReplayMacroCompatibility = z.object({
  schemaVersion: z.string().min(1),
  methodologyVersion: z.string().min(1),
  signatureVersion: z.string().min(1),
});

export const ReplayStructureCompatibility = z.object({
  schemaVersion: z.string().min(1),
  methodologyId: z.string().min(1),
  methodologyVersion: z.string().min(1),
  featureMethodologyId: z.string().min(1),
  featureMethodologyVersion: z.string().min(1),
  underlying: z.string().min(1),
});

export const ReplayCatalystCompatibility = z.object({
  schemaVersion: z.string().min(1),
});

export const ReplayCorpus = z.object({
  kind: z.literal("ReplayCorpus"),
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  macroCompatibility: ReplayMacroCompatibility,
  structureCompatibility: ReplayStructureCompatibility,
  catalystCompatibility: ReplayCatalystCompatibility,
  macro: z.array(ReplayMacroArtifact),
  marketStructure: z.array(ReplayStructureArtifact),
  catalystEvidence: z.array(ReplayCatalystArtifact),
});

export const ReplaySourceRef = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    sourceKind: ReplaySourceKind,
    artifactId: z.string().min(1),
    availableAt: IsoDateTime,
    schemaVersion: z.string().min(1),
    methodologyId: z.string().optional(),
    methodologyVersion: z.string().optional(),
    featureMethodologyId: z.string().optional(),
    featureMethodologyVersion: z.string().optional(),
    signatureVersion: z.string().optional(),
    underlying: z.string().optional(),
    snapshotId: z.string().optional(),
    catalystId: z.string().optional(),
    marketSessionDate: IsoDate.optional(),
    sessionDate: IsoDate.optional(),
    synthetic: z.boolean(),
    sourceStatus: z.string().min(1),
    limitations: z.array(z.string()),
  }),
  z.object({
    status: z.literal("unavailable"),
    sourceKind: ReplaySourceKind,
    reason: z.string().min(1),
  }),
]);

export const ReplayFrame = z.object({
  kind: z.literal("ReplayFrame"),
  frameId: z.string().min(1),
  evaluationAt: IsoDateTime,
  macro: ReplaySourceRef,
  marketStructure: ReplaySourceRef,
  catalystEvidence: ReplaySourceRef,
});

/**
 * Ordered point-in-time replay over stored artifacts.
 * No returns, outcomes, regime conclusions, or scores.
 */
export const ReplayRun = z.object({
  kind: z.literal("ReplayRun"),
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  methodologyId: z.literal(REPLAY_METHODOLOGY_ID),
  methodologyVersion: z.literal(REPLAY_METHODOLOGY_VERSION),
  runId: z.string().min(1),
  frames: z.array(ReplayFrame),
});

export type ReplayMacroArtifact = z.infer<typeof ReplayMacroArtifact>;
export type ReplayStructureArtifact = z.infer<typeof ReplayStructureArtifact>;
export type ReplayCatalystArtifact = z.infer<typeof ReplayCatalystArtifact>;
export type ReplayMacroCompatibility = z.infer<typeof ReplayMacroCompatibility>;
export type ReplayStructureCompatibility = z.infer<
  typeof ReplayStructureCompatibility
>;
export type ReplayCatalystCompatibility = z.infer<
  typeof ReplayCatalystCompatibility
>;
export type ReplayCorpus = z.infer<typeof ReplayCorpus>;
export type ReplaySourceRef = z.infer<typeof ReplaySourceRef>;
export type ReplayFrame = z.infer<typeof ReplayFrame>;
export type ReplayRun = z.infer<typeof ReplayRun>;
export type ReplaySourceKind = z.infer<typeof ReplaySourceKind>;
