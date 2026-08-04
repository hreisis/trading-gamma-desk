import { join } from "node:path";
import {
  RealArchivePeerCorpus,
  buildResearchArchiveId,
  buildStudyId,
  type RealArchivePeerCorpus as CorpusDto,
} from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { buildStudyMatchProfile } from "../match-profile";
import { buildDailyResearchArchive } from "../build-archive";
import {
  dailyResearchArchivePath,
  readDailyResearchArchive,
  writeDailyResearchArchive,
} from "../archive-store";
import { inventoryRealArchiveSessions } from "./inventory";
import {
  discoverDriverCandidates,
  filterCandidatesThrough,
} from "./discover-candidates";
import { resolveRealArchiveSession } from "./resolve-session";
import { resolveExactDateStructure } from "./resolve-structure";
import { realArchivePeerCorpusPath } from "./paths";

export class RealArchiveBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealArchiveBuildError";
  }
}

export interface BuildRealArchivesResult {
  readonly inventory: ReturnType<typeof inventoryRealArchiveSessions>;
  readonly builtSessionDates: string[];
  readonly skippedSessionDates: string[];
  readonly corpus: CorpusDto;
  readonly corpusPath: string;
}

export function buildRealArchives(input: {
  readonly throughDate: string;
  readonly dataRoot?: string;
  readonly builtAt?: string;
  readonly symbol?: string;
  readonly dryRun?: boolean;
}): BuildRealArchivesResult {
  const dataRoot = input.dataRoot ?? "data";
  const builtAt = input.builtAt ?? new Date().toISOString();
  const symbol = input.symbol ?? "SPY";
  const inventory = inventoryRealArchiveSessions({
    throughDate: input.throughDate,
    dataRoot,
    builtAt,
  });

  const builtSessionDates: string[] = [];
  const skippedSessionDates: string[] = [];
  const profiles = [];

  const candidates = filterCandidatesThrough(
    discoverDriverCandidates(dataRoot),
    input.throughDate,
  ).included;

  for (const candidate of candidates) {
    const resolved = resolveRealArchiveSession({
      candidate,
      dataRoot,
      builtAt,
      symbol,
    });

    if (resolved.classification !== "eligible") {
      skippedSessionDates.push(resolved.sessionDate);
      continue;
    }

    if (!resolved.corpus || !resolved.driver) {
      skippedSessionDates.push(resolved.sessionDate);
      continue;
    }

    const archive = buildDailyResearchArchive({
      sessionDate: resolved.sessionDate,
      runId: `real-archive|${resolved.sessionDate}`,
      builtAt,
      evaluationInstants: resolved.sourcesManifest.evaluationInstants,
      corpus: resolved.corpus,
      components: resolved.components,
    });

    if (archive.eligibility.status !== "eligible") {
      skippedSessionDates.push(resolved.sessionDate);
      continue;
    }

    const archivePath = dailyResearchArchivePath(dataRoot, resolved.sessionDate);
    if (!input.dryRun) {
      writeDailyResearchArchive(archivePath, archive);
    }
    builtSessionDates.push(resolved.sessionDate);

    const studyId = buildStudyId(
      buildResearchArchiveId(resolved.sessionDate),
      symbol,
    );

    let gammaRegime: string | undefined;
    if (resolved.components.boundedStructure.status === "available") {
      const structureRes = resolveExactDateStructure({
        sessionDate: resolved.sessionDate,
        dataRoot,
        symbol,
      });
      gammaRegime = structureRes.resolved?.marketStructureState?.regime ?? undefined;
    }

    profiles.push(
      buildStudyMatchProfile({
        studyId,
        sessionDate: resolved.sessionDate,
        archive,
        enrichment: gammaRegime ? { gammaRegime } : undefined,
      }),
    );
  }

  const included = builtSessionDates.map((sessionDate) => ({
    sessionDate,
    studyId: buildStudyId(buildResearchArchiveId(sessionDate), symbol),
    archiveRelativePath: join(
      "studies",
      "archive",
      sessionDate,
      "daily-research.json",
    ),
  }));

  const excluded = inventory.entries
    .filter((e) => !builtSessionDates.includes(e.sessionDate))
    .map((e) => ({
      sessionDate: e.sessionDate,
      classification: e.classification,
      reasons:
        e.exclusionReasons.length > 0
          ? e.exclusionReasons
          : ["not eligible for real archive build"],
    }));

  const eligibleCount = builtSessionDates.length;
  const matchingViable = eligibleCount >= 2;
  const corpusArtifact = RealArchivePeerCorpus.parse({
    kind: "RealArchivePeerCorpus",
    schemaVersion: "0.1.0",
    throughDate: input.throughDate,
    builtAt,
    sourceKind: "local_store",
    synthetic: false,
    methodologyId: "real_archive_peer_corpus_v1",
    methodologyVersion: "0.1.0",
    included,
    excluded,
    profiles,
    coverage: {
      candidateSessions: inventory.summary.candidateSessions,
      eligibleArchives: eligibleCount,
      exactDateStructureSessions: inventory.summary.exactDateStructureSessions,
      catalystPitSessions: inventory.summary.catalystPitSessions,
      matchingViable,
      matchingViableNote: matchingViable
        ? `${eligibleCount} eligible archives — sufficient for similar-regime matching.`
        : `${eligibleCount} eligible archive(s) — insufficient for multi-session matching (need ≥2).`,
    },
  });

  const corpusPath = realArchivePeerCorpusPath(dataRoot, input.throughDate);
  if (!input.dryRun) {
    writeJsonAtomic(corpusPath, corpusArtifact);
  }

  return {
    inventory,
    builtSessionDates,
    skippedSessionDates,
    corpus: corpusArtifact,
    corpusPath,
  };
}

export function parseBuildArchiveArgs(argv: readonly string[]): {
  throughDate: string;
  dataRoot: string;
  dryRun: boolean;
} {
  let throughDate: string | undefined;
  let dataRoot = "data";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--through=")) {
      throughDate = arg.slice("--through=".length);
      continue;
    }
    if (arg === "--through") {
      throughDate = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg === "--data-root") {
      dataRoot = argv[++i]!;
      continue;
    }
    throw new RealArchiveBuildError(`unknown argument: ${arg}`);
  }

  if (!throughDate) {
    throw new RealArchiveBuildError(
      "--through is required (explicit PIT cutoff — no latest fallback)",
    );
  }

  return { throughDate, dataRoot, dryRun };
}

export { readDailyResearchArchive };
