import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";
import { GammaAvailability } from "./estimated-gamma";
import { BOUNDED_GAMMA_SCOPE } from "./bounded-gamma-provider";
import { ReplayCorpus, ReplayRun } from "./replay";

export const RESEARCH_ARCHIVE_SCHEMA_VERSION = "0.1.0";
export const RESEARCH_ARCHIVE_METHODOLOGY_ID = "pit_research_archive_v1";
export const RESEARCH_ARCHIVE_METHODOLOGY_VERSION = "0.1.0";

export const STUDY_SOURCES_MANIFEST_SCHEMA_VERSION = "0.1.0";

export const ArchiveComponentKind = z.enum([
  "macro",
  "market_structure",
  "bounded_structure",
  "catalyst_evidence",
]);

export const ArchiveSourceKind = z.enum(["fixture", "local_store"]);

export const ArchiveProvenance = z.object({
  sourceKind: ArchiveSourceKind,
  /** Repo-relative or data-root-relative path — audit only, not loaded at replay. */
  relativePath: z.string().min(1),
  artifactId: z.string().min(1),
  schemaVersion: z.string().min(1),
  availableAt: IsoDateTime,
  synthetic: z.boolean(),
});

export const ArchiveComponent = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    kind: ArchiveComponentKind,
    provenance: ArchiveProvenance,
    limitations: z.array(z.string()),
    sessionDate: IsoDate.optional(),
    marketSessionDate: IsoDate.optional(),
    underlying: z.string().min(1).optional(),
    snapshotId: z.string().min(1).optional(),
    catalystId: z.string().min(1).optional(),
    scope: z.literal(BOUNDED_GAMMA_SCOPE).optional(),
    expiration: IsoDate.optional(),
    dte: z.number().int().nonnegative().optional(),
    gammaAvailability: GammaAvailability.optional(),
    symbol: z.string().min(1).optional(),
  }),
  z.object({
    status: z.literal("unavailable"),
    kind: ArchiveComponentKind,
    reason: z.string().min(1),
  }),
]);

export const StudyEligibility = z.object({
  status: z.enum(["eligible", "partial", "ineligible"]),
  methodologyId: z.literal(RESEARCH_ARCHIVE_METHODOLOGY_ID),
  methodologyVersion: z.literal(RESEARCH_ARCHIVE_METHODOLOGY_VERSION),
  sessionDate: IsoDate,
  requiredKinds: z.array(ArchiveComponentKind),
  satisfiedKinds: z.array(ArchiveComponentKind),
  missingKinds: z.array(ArchiveComponentKind),
  reasons: z.array(z.string()),
  conservativeRulesApplied: z.array(z.string()).min(1),
});

/**
 * Immutable PIT-safe daily research archive for offline exact-date replay.
 * Embeds validated ReplayCorpus + ReplayRun — no returns, scores, or LLM output.
 */
export const DailyResearchArchive = z
  .object({
    kind: z.literal("DailyResearchArchive"),
    schemaVersion: z.literal(RESEARCH_ARCHIVE_SCHEMA_VERSION),
    archiveId: z.string().min(1),
    sessionDate: IsoDate,
    builtAt: IsoDateTime,
    methodologyId: z.literal(RESEARCH_ARCHIVE_METHODOLOGY_ID),
    methodologyVersion: z.literal(RESEARCH_ARCHIVE_METHODOLOGY_VERSION),
    components: z.object({
      macro: ArchiveComponent,
      marketStructure: ArchiveComponent,
      boundedStructure: ArchiveComponent,
      catalystEvidence: z.array(ArchiveComponent),
    }),
    eligibility: StudyEligibility,
    /** Explicit evaluation instants for this session — never a latest-fallback clock. */
    evaluationInstants: z.array(IsoDateTime).min(1),
    corpus: ReplayCorpus,
    replayRun: ReplayRun,
  })
  .superRefine((archive, ctx) => {
    const expectedId = buildResearchArchiveId(archive.sessionDate);
    if (archive.archiveId !== expectedId) {
      ctx.addIssue({
        code: "custom",
        message: `archiveId must be ${expectedId}`,
        path: ["archiveId"],
      });
    }
    if (archive.eligibility.sessionDate !== archive.sessionDate) {
      ctx.addIssue({
        code: "custom",
        message: "eligibility.sessionDate must match sessionDate",
        path: ["eligibility", "sessionDate"],
      });
    }
    for (const instant of archive.evaluationInstants) {
      if (!instant.startsWith(archive.sessionDate)) {
        ctx.addIssue({
          code: "custom",
          message: `evaluationInstant ${instant} must fall on sessionDate ${archive.sessionDate}`,
          path: ["evaluationInstants"],
        });
      }
    }
  });

/**
 * Fixture/local manifest for building an archive without network I/O.
 */
export const StudySourcesManifest = z.object({
  kind: z.literal("StudySourcesManifest"),
  schemaVersion: z.literal(STUDY_SOURCES_MANIFEST_SCHEMA_VERSION),
  sessionDate: IsoDate,
  runId: z.string().min(1),
  builtAt: IsoDateTime,
  evaluationInstants: z.array(IsoDateTime).min(1),
  corpusPath: z.string().min(1),
  /** Exact structure snapshotId — no latest-fallback selection. */
  marketStructureSnapshotId: z.string().min(1),
  macroArtifactId: z.string().min(1),
  boundedStructurePath: z.string().min(1).optional(),
  catalystArtifactIds: z.array(z.string().min(1)),
});

export function buildResearchArchiveId(sessionDate: string): string {
  return `research|${sessionDate}|${RESEARCH_ARCHIVE_METHODOLOGY_VERSION}`;
}

export type ArchiveComponentKind = z.infer<typeof ArchiveComponentKind>;
export type ArchiveSourceKind = z.infer<typeof ArchiveSourceKind>;
export type ArchiveProvenance = z.infer<typeof ArchiveProvenance>;
export type ArchiveComponent = z.infer<typeof ArchiveComponent>;
export type StudyEligibility = z.infer<typeof StudyEligibility>;
export type DailyResearchArchive = z.infer<typeof DailyResearchArchive>;
export type StudySourcesManifest = z.infer<typeof StudySourcesManifest>;
