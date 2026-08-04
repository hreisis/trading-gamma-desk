import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DailyResearchArchive,
  SimilarRegimeStudy,
  StudyDefinition,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchProfile,
  StudyMemo,
  StudyPipelineManifest,
  StudyPipelineRun,
  StudyPriceSeries,
  type StudyPipelineArtifactPaths,
} from "@/contracts";
import { runStudyMemoWorkflow } from "@/study-agent/build-memo-workflow";
import { studyMemoPath, writeStudyMemo } from "@/study-agent/memo-store";
import {
  buildDailyResearchArchive,
} from "./build-archive";
import { buildSimilarRegimeStudy } from "./build-similar-regime-study";
import { buildStudyDefinition } from "./build-definition";
import { buildStudyEvidenceBundle } from "./build-evidence-bundle";
import { buildStudyForwardOutcome } from "./build-outcome";
import {
  assertPriceSeriesAsOfMatch,
  resolvePriceSourceKind,
} from "./build-price-series";
import { buildStudyMatchProfile } from "./match-profile";
import { loadStudySourcesFromFile } from "./load-sources";
import {
  dailyResearchArchivePath,
  readDailyResearchArchive,
  writeDailyResearchArchive,
} from "./archive-store";
import {
  similarRegimeStudyPath,
  studyDefinitionPath,
  studyEvidenceBundlePath,
  studyForwardOutcomePath,
  studyPipelineRunPath,
  writeStudyArtifact,
} from "./pipeline-store";

export class StudyPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyPipelineError";
  }
}

export interface RunStudyPipelineOptions {
  readonly sessionDate: string;
  readonly manifestPath: string;
  readonly repoRoot?: string;
  readonly dataRoot?: string;
  readonly dryRun?: boolean;
}

export interface StudyPipelineResult {
  readonly run: StudyPipelineRun;
  readonly definition: StudyDefinition;
  readonly queryOutcome: StudyForwardOutcome;
  readonly similarRegimeStudy: SimilarRegimeStudy;
  readonly evidenceBundle: StudyEvidenceBundle;
  readonly memo: StudyMemo;
  readonly memoSource: StudyPipelineRun["memoSource"];
}

function readManifest(path: string, repoRoot: string): StudyPipelineManifest {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, path), "utf8"),
  ) as unknown;
  return StudyPipelineManifest.parse(raw);
}

function readPriceSeries(
  relativePath: string,
  repoRoot: string,
  expectedAsOf?: string,
): StudyPriceSeries {
  const series = StudyPriceSeries.parse(
    JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")),
  );
  if (expectedAsOf !== undefined) {
    assertPriceSeriesAsOfMatch(series, expectedAsOf);
  }
  return series;
}

function readMatchProfile(
  relativePath: string,
  repoRoot: string,
): StudyMatchProfile {
  return StudyMatchProfile.parse(
    JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")),
  );
}

function resolveQueryArchive(
  manifest: StudyPipelineManifest,
  repoRoot: string,
  dataRoot: string,
  sessionDate: string,
): DailyResearchArchive {
  const { query } = manifest;
  if (query.archivePath) {
    return readDailyResearchArchive(join(repoRoot, query.archivePath));
  }
  if (query.sourcesManifest) {
    const loaded = loadStudySourcesFromFile(query.sourcesManifest, repoRoot);
    if (loaded.manifest.sessionDate !== sessionDate) {
      throw new StudyPipelineError(
        `manifest sessionDate ${loaded.manifest.sessionDate} != --date ${sessionDate}`,
      );
    }
    const archive = buildDailyResearchArchive({
      sessionDate,
      corpus: loaded.corpus,
      components: loaded.components,
      runId: loaded.manifest.runId,
      builtAt: loaded.manifest.builtAt,
      evaluationInstants: loaded.manifest.evaluationInstants,
    });
    const archivePath = dailyResearchArchivePath(dataRoot, sessionDate);
    writeDailyResearchArchive(archivePath, archive);
    return archive;
  }
  throw new StudyPipelineError(
    "query requires archivePath or sourcesManifest — no latest-fallback",
  );
}

function buildPeerDefinition(input: {
  readonly profile: StudyMatchProfile;
  readonly symbol: string;
  readonly profileRelativePath: string;
  readonly builtAt: string;
}): StudyDefinition {
  return StudyDefinition.parse({
    kind: "StudyDefinition",
    schemaVersion: "0.1.0",
    studyId: input.profile.studyId,
    archiveId: `research|${input.profile.sessionDate}|0.1.0`,
    sessionDate: input.profile.sessionDate,
    symbol: input.symbol,
    archiveRef: {
      relativePath: input.profileRelativePath,
      schemaVersion: "0.1.0",
    },
    builtAt: input.builtAt,
    methodologyId: "study_definition_v1",
    methodologyVersion: "0.1.0",
    synthetic: true,
    limitations: [
      "Peer StudyDefinition anchored from explicit match profile — query archive is separate.",
      "Forward outcomes are separate artifacts — never merged into PIT archive inputs.",
    ],
  });
}

export async function runStudyPipeline(
  options: RunStudyPipelineOptions,
): Promise<StudyPipelineResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const dataRoot = options.dataRoot ?? "data";
  const dryRun = options.dryRun ?? false;
  const manifest = readManifest(options.manifestPath, repoRoot);

  if (manifest.sessionDate !== options.sessionDate) {
    throw new StudyPipelineError(
      `manifest sessionDate ${manifest.sessionDate} != --date ${options.sessionDate}`,
    );
  }

  const { symbol, computedAt } = manifest;
  const archive = resolveQueryArchive(
    manifest,
    repoRoot,
    dataRoot,
    options.sessionDate,
  );

  if (archive.sessionDate !== options.sessionDate) {
    throw new StudyPipelineError(
      `archive sessionDate ${archive.sessionDate} != --date ${options.sessionDate}`,
    );
  }

  const queryArchiveRelativePath =
    manifest.query.archivePath ??
    join("studies", "archive", options.sessionDate, "daily-research.json");

  const queryPrices = readPriceSeries(
    manifest.query.priceSeriesPath,
    repoRoot,
    manifest.query.priceSeriesAsOfSessionDate,
  );
  const queryPriceSourceKind = resolvePriceSourceKind(
    queryPrices,
    manifest.query.priceSeriesPath,
  );
  const definition = buildStudyDefinition({
    archive,
    symbol,
    archiveRelativePath: queryArchiveRelativePath,
    builtAt: computedAt,
    synthetic: queryPrices.synthetic,
  });

  const queryOutcome = buildStudyForwardOutcome({
    definition,
    priceSeries: queryPrices,
    priceSeriesAsOfSessionDate: manifest.query.priceSeriesAsOfSessionDate,
    computedAt,
    priceSourceKind: queryPriceSourceKind,
    priceRelativePath: manifest.query.priceSeriesPath,
  });

  const queryProfile = buildStudyMatchProfile({
    studyId: definition.studyId,
    sessionDate: definition.sessionDate,
    archive,
    enrichment: { gammaRegime: manifest.query.gammaRegime },
  });

  const corpus = manifest.similarRegime.corpus.map((entry) => {
    const profile = readMatchProfile(entry.profilePath, repoRoot);
    const pricePath = entry.priceSeriesPath ?? manifest.query.priceSeriesPath;
    const priceAsOf =
      entry.priceSeriesAsOfSessionDate ??
      manifest.query.priceSeriesAsOfSessionDate;
    const prices = readPriceSeries(pricePath, repoRoot, priceAsOf);
    const priceSourceKind = resolvePriceSourceKind(prices, pricePath);
    const peerDefinition = buildPeerDefinition({
      profile,
      symbol,
      profileRelativePath: entry.profilePath,
      builtAt: computedAt,
    });
    const outcome = buildStudyForwardOutcome({
      definition: peerDefinition,
      priceSeries: prices,
      priceSeriesAsOfSessionDate: priceAsOf,
      computedAt,
      priceSourceKind,
      priceRelativePath: pricePath,
    });
    return { profile, outcome };
  });

  const similarRegimeStudy = buildSimilarRegimeStudy({
    queryProfile,
    corpus,
    criteria: {
      factors: manifest.similarRegime.factors,
      excludeQueryStudy: manifest.similarRegime.excludeQueryStudy,
      minMatureSampleSize: manifest.similarRegime.minMatureSampleSize,
    },
    computedAt,
  });

  const evidenceBundle = buildStudyEvidenceBundle({
    similarRegimeStudy,
    symbol,
    computedAt,
    sources: [
      {
        kind: "similar_regime_study",
        refId: similarRegimeStudy.studyId,
        schemaVersion: "0.1.0",
      },
      {
        kind: "daily_research_archive",
        refId: archive.archiveId,
        relativePath: queryArchiveRelativePath,
        schemaVersion: "0.1.0",
      },
      ...corpus.map((entry) => ({
        kind: "study_definition" as const,
        refId: entry.profile.studyId,
        schemaVersion: "0.1.0" as const,
      })),
    ],
  });

  const forceFallback = manifest.memo?.forceFallback ?? true;
  const memoWorkflow = await runStudyMemoWorkflow({
    bundle: evidenceBundle,
    config: { apiKey: null },
    forceFallback,
    generatedAt: computedAt,
    synthetic: true,
  });

  if (
    memoWorkflow.memo.status === "rejected" ||
    memoWorkflow.memo.status === "unavailable"
  ) {
    throw new StudyPipelineError(
      `memo validation failed: status=${memoWorkflow.memo.status}`,
    );
  }

  const artifactPaths: StudyPipelineArtifactPaths = {
    archive: manifest.query.archivePath
      ? join(repoRoot, manifest.query.archivePath)
      : dailyResearchArchivePath(dataRoot, options.sessionDate),
    definition: studyDefinitionPath(dataRoot, options.sessionDate, symbol),
    queryOutcome: studyForwardOutcomePath(
      dataRoot,
      definition.studyId,
      manifest.query.priceSeriesAsOfSessionDate,
    ),
    similarRegimeStudy: similarRegimeStudyPath(
      dataRoot,
      options.sessionDate,
      symbol,
    ),
    evidenceBundle: studyEvidenceBundlePath(
      dataRoot,
      options.sessionDate,
      symbol,
    ),
    memo: studyMemoPath(dataRoot, options.sessionDate),
  };

  if (!dryRun) {
    writeStudyArtifact(
      artifactPaths.definition,
      StudyDefinition,
      definition,
    );
    writeStudyArtifact(
      artifactPaths.queryOutcome,
      StudyForwardOutcome,
      queryOutcome,
    );
    for (const entry of corpus) {
      writeStudyArtifact(
        studyForwardOutcomePath(
          dataRoot,
          entry.profile.studyId,
          entry.outcome.priceSeriesAsOfSessionDate,
        ),
        StudyForwardOutcome,
        entry.outcome,
      );
    }
    writeStudyArtifact(
      artifactPaths.similarRegimeStudy,
      SimilarRegimeStudy,
      similarRegimeStudy,
    );
    writeStudyArtifact(
      artifactPaths.evidenceBundle,
      StudyEvidenceBundle,
      evidenceBundle,
    );
    writeStudyMemo(artifactPaths.memo, memoWorkflow.memo);
  }

  const run = StudyPipelineRun.parse({
    kind: "StudyPipelineRun",
    schemaVersion: "0.1.0",
    sessionDate: options.sessionDate,
    symbol,
    manifestPath: options.manifestPath,
    completedAt: computedAt,
    computedAt,
    studyId: definition.studyId,
    evidenceStatus: evidenceBundle.evidenceStatus,
    memoStatus: memoWorkflow.memo.status,
    memoSource: memoWorkflow.source,
    artifactPaths,
  });

  if (!dryRun) {
    writeStudyArtifact(studyPipelineRunPath(dataRoot, options.sessionDate), StudyPipelineRun, run);
  }

  return {
    run,
    definition,
    queryOutcome,
    similarRegimeStudy,
    evidenceBundle,
    memo: memoWorkflow.memo,
    memoSource: memoWorkflow.source,
  };
}

export function parseStudyPipelineArgs(argv: readonly string[]): {
  sessionDate: string;
  manifestPath: string;
  dataRoot: string;
  repoRoot: string;
  dryRun: boolean;
} {
  let sessionDate: string | undefined;
  let manifestPath: string | undefined;
  let dataRoot = "data";
  let repoRoot = process.cwd();
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      sessionDate = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--date") {
      sessionDate = argv[++i];
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
      continue;
    }
    if (arg === "--manifest") {
      manifestPath = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg.startsWith("--repo-root=")) {
      repoRoot = arg.slice("--repo-root=".length);
      continue;
    }
    throw new StudyPipelineError(`unknown argument: ${arg}`);
  }

  if (!sessionDate) {
    throw new StudyPipelineError(
      "--date is required (exact sessionDate — no latest fallback)",
    );
  }
  if (!manifestPath) {
    throw new StudyPipelineError("--manifest is required");
  }

  return { sessionDate, manifestPath, dataRoot, repoRoot, dryRun };
}
