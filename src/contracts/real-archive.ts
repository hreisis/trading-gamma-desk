import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import { ArchiveSourceKind } from "./research-archive";
import { StudyMatchProfile } from "./similar-regime-study";

export const REAL_ARCHIVE_SOURCES_MANIFEST_SCHEMA_VERSION = "0.1.0";
export const REAL_ARCHIVE_INVENTORY_SCHEMA_VERSION = "0.1.0";
export const REAL_ARCHIVE_PEER_CORPUS_SCHEMA_VERSION = "0.1.0";
export const REAL_ARCHIVE_PEER_CORPUS_METHODOLOGY_ID = "real_archive_peer_corpus_v1";
export const REAL_ARCHIVE_PEER_CORPUS_METHODOLOGY_VERSION = "0.1.0";

export const RealArchiveSessionClassification = z.enum([
  "eligible",
  "partial",
  "ineligible",
  "invalid",
]);

export const RealArchiveComponentSourceRef = z.object({
  sourceKind: z.literal("local_store"),
  synthetic: z.literal(false),
  relativePath: z.string().min(1),
  artifactId: z.string().min(1),
  schemaVersion: z.string().min(1).optional(),
  availableAt: IsoDateTime.optional(),
  sessionDate: IsoDate.optional(),
  effectiveAsOf: IsoDate.optional(),
});

/**
 * Per-session manifest describing exact local source artifacts used to build
 * a non-synthetic DailyResearchArchive entry. Audit-only paths — repo-relative.
 */
export const RealArchiveSessionSourcesManifest = z.object({
  kind: z.literal("RealArchiveSessionSourcesManifest"),
  schemaVersion: z.literal(REAL_ARCHIVE_SOURCES_MANIFEST_SCHEMA_VERSION),
  sessionDate: IsoDate,
  builtAt: IsoDateTime,
  sourceKind: z.literal("local_store"),
  synthetic: z.literal(false),
  evaluationInstants: z.array(IsoDateTime).min(1),
  macro: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("resolved"),
      ref: RealArchiveComponentSourceRef,
    }),
    z.object({
      status: z.literal("missing"),
      reason: z.string().min(1),
    }),
  ]),
  marketStructure: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("resolved"),
      ref: RealArchiveComponentSourceRef,
      resolution: z.enum(["historical_snapshot", "bounded_exact_date"]),
    }),
    z.object({
      status: z.literal("missing"),
      reason: z.string().min(1),
    }),
  ]),
  boundedStructure: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("resolved"),
      ref: RealArchiveComponentSourceRef,
    }),
    z.object({
      status: z.literal("missing"),
      reason: z.string().min(1),
    }),
  ]),
  catalystEvidence: z.object({
    status: z.enum(["resolved", "none_available", "cache_unavailable"]),
    refs: z.array(RealArchiveComponentSourceRef),
    reason: z.string().optional(),
  }),
});

export const RealArchiveInventoryEntry = z.object({
  sessionDate: IsoDate,
  classification: RealArchiveSessionClassification,
  exclusionReasons: z.array(z.string()),
  sourcesManifest: RealArchiveSessionSourcesManifest.optional(),
});

export const RealArchiveInventoryReport = z.object({
  kind: z.literal("RealArchiveInventoryReport"),
  schemaVersion: z.literal(REAL_ARCHIVE_INVENTORY_SCHEMA_VERSION),
  throughDate: IsoDate,
  builtAt: IsoDateTime,
  dataRoot: z.string().min(1),
  entries: z.array(RealArchiveInventoryEntry),
  summary: z.object({
    candidateSessions: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    ineligible: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    exactDateStructureSessions: z.number().int().nonnegative(),
    catalystPitSessions: z.number().int().nonnegative(),
  }),
  exclusionReasonCounts: z.record(z.string(), z.number().int().nonnegative()),
});

export const RealArchivePeerCorpusEntry = z.object({
  sessionDate: IsoDate,
  studyId: z.string().min(1),
  archiveRelativePath: z.string().min(1),
});

export const RealArchivePeerCorpusExcluded = z.object({
  sessionDate: IsoDate,
  classification: RealArchiveSessionClassification,
  reasons: z.array(z.string()).min(1),
});

export const RealArchivePeerCorpus = z.object({
  kind: z.literal("RealArchivePeerCorpus"),
  schemaVersion: z.literal(REAL_ARCHIVE_PEER_CORPUS_SCHEMA_VERSION),
  throughDate: IsoDate,
  builtAt: IsoDateTime,
  sourceKind: z.literal("local_store"),
  synthetic: z.literal(false),
  methodologyId: z.literal(REAL_ARCHIVE_PEER_CORPUS_METHODOLOGY_ID),
  methodologyVersion: z.literal(REAL_ARCHIVE_PEER_CORPUS_METHODOLOGY_VERSION),
  included: z.array(RealArchivePeerCorpusEntry),
  excluded: z.array(RealArchivePeerCorpusExcluded),
  profiles: z.array(StudyMatchProfile),
  coverage: z.object({
    candidateSessions: z.number().int().nonnegative(),
    eligibleArchives: z.number().int().nonnegative(),
    exactDateStructureSessions: z.number().int().nonnegative(),
    catalystPitSessions: z.number().int().nonnegative(),
    matchingViable: z.boolean(),
    matchingViableNote: z.string().min(1),
  }),
});

export function realArchivePeerCorpusRelPath(throughDate: string): string {
  return `studies/profiles/${throughDate}/peer-corpus.json`;
}

export type RealArchiveSessionClassification = z.infer<
  typeof RealArchiveSessionClassification
>;
export type RealArchiveComponentSourceRef = z.infer<
  typeof RealArchiveComponentSourceRef
>;
export type RealArchiveSessionSourcesManifest = z.infer<
  typeof RealArchiveSessionSourcesManifest
>;
export type RealArchiveInventoryEntry = z.infer<
  typeof RealArchiveInventoryEntry
>;
export type RealArchiveInventoryReport = z.infer<
  typeof RealArchiveInventoryReport
>;
export type RealArchivePeerCorpus = z.infer<typeof RealArchivePeerCorpus>;
