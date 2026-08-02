import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  BoundedGammaProviderSnapshot,
  BOUNDED_GAMMA_SCOPE,
  ReplayCorpus,
  StudySourcesManifest,
  type ArchiveComponent,
  type ArchiveProvenance,
  type ArchiveSourceKind,
  type BoundedGammaProviderSnapshot as BoundedDto,
  type ReplayCorpus as ReplayCorpusDto,
  type StudySourcesManifest as ManifestDto,
} from "@/contracts";
import { validateReplayCorpus } from "@/replay";

export class StudySourcesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudySourcesError";
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolvePath(root: string, relativePath: string): string {
  return join(root, relativePath);
}

function provenanceFrom(
  sourceKind: ArchiveSourceKind,
  relativePath: string,
  artifactId: string,
  schemaVersion: string,
  availableAt: string,
  synthetic: boolean,
): ArchiveProvenance {
  return {
    sourceKind,
    relativePath,
    artifactId,
    schemaVersion,
    availableAt,
    synthetic,
  };
}

function findMacro(
  corpus: ReplayCorpusDto,
  artifactId: string,
  relativePath: string,
  sourceKind: ArchiveSourceKind,
): ArchiveComponent {
  const artifact = corpus.macro.find((a) => a.artifactId === artifactId);
  if (!artifact) {
    return {
      status: "unavailable",
      kind: "macro",
      reason: `macro artifactId ${artifactId} not found in corpus — no latest-fallback`,
    };
  }
  return {
    status: "available",
    kind: "macro",
    provenance: provenanceFrom(
      sourceKind,
      relativePath,
      artifact.artifactId,
      artifact.schemaVersion,
      artifact.availableAt,
      artifact.synthetic,
    ),
    limitations: [...artifact.limitations],
    marketSessionDate: artifact.marketSessionDate,
  };
}

function findStructure(
  corpus: ReplayCorpusDto,
  snapshotId: string,
  relativePath: string,
  sourceKind: ArchiveSourceKind,
): ArchiveComponent {
  const artifact = corpus.marketStructure.find(
    (a) => a.snapshotId === snapshotId,
  );
  if (!artifact) {
    return {
      status: "unavailable",
      kind: "market_structure",
      reason: `marketStructure snapshotId ${snapshotId} not found in corpus — no latest-fallback`,
    };
  }
  return {
    status: "available",
    kind: "market_structure",
    provenance: provenanceFrom(
      sourceKind,
      relativePath,
      artifact.artifactId,
      artifact.schemaVersion,
      artifact.availableAt,
      artifact.synthetic,
    ),
    limitations: [...artifact.limitations],
    sessionDate: artifact.sessionDate,
    underlying: artifact.underlying,
    snapshotId: artifact.snapshotId,
  };
}

function findCatalysts(
  corpus: ReplayCorpusDto,
  artifactIds: readonly string[],
  relativePath: string,
  sourceKind: ArchiveSourceKind,
): ArchiveComponent[] {
  return artifactIds.map((artifactId) => {
    const artifact = corpus.catalystEvidence.find(
      (a) => a.artifactId === artifactId,
    );
    if (!artifact) {
      return {
        status: "unavailable" as const,
        kind: "catalyst_evidence" as const,
        reason: `catalyst artifactId ${artifactId} not found in corpus`,
      };
    }
    return {
      status: "available" as const,
      kind: "catalyst_evidence" as const,
      provenance: provenanceFrom(
        sourceKind,
        relativePath,
        artifact.artifactId,
        artifact.schemaVersion,
        artifact.publishedAt,
        artifact.synthetic,
      ),
      limitations: [...artifact.limitations],
      catalystId: artifact.catalystId,
    };
  });
}

function boundedComponentFromSnapshot(
  snapshot: BoundedDto,
  relativePath: string,
  sourceKind: ArchiveSourceKind,
): ArchiveComponent {
  if (snapshot.scope !== BOUNDED_GAMMA_SCOPE) {
    return {
      status: "unavailable",
      kind: "bounded_structure",
      reason: `expected scope ${BOUNDED_GAMMA_SCOPE}, got ${snapshot.scope}`,
    };
  }
  const artifactId = `bounded|${snapshot.symbol}|${snapshot.expiration}|${snapshot.sessionDate}`;
  return {
    status: "available",
    kind: "bounded_structure",
    provenance: provenanceFrom(
      sourceKind,
      relativePath,
      artifactId,
      snapshot.schemaVersion,
      snapshot.vendorAsOf,
      snapshot.synthetic,
    ),
    limitations: [...snapshot.limitations],
    scope: snapshot.scope,
    expiration: snapshot.expiration,
    dte: snapshot.dte,
    gammaAvailability: snapshot.status,
    symbol: snapshot.symbol,
    sessionDate: snapshot.sessionDate,
  };
}

export interface LoadStudySourcesInput {
  readonly manifest: ManifestDto;
  readonly repoRoot?: string;
  readonly sourceKind?: ArchiveSourceKind;
}

export interface LoadedStudySources {
  readonly manifest: ManifestDto;
  readonly corpus: ReplayCorpusDto;
  readonly components: {
    readonly macro: ArchiveComponent;
    readonly marketStructure: ArchiveComponent;
    readonly boundedStructure: ArchiveComponent;
    readonly catalystEvidence: readonly ArchiveComponent[];
  };
}

/**
 * Resolve exact-id components from a manifest + on-disk fixtures/local store.
 * Never selects latest across sessions or fabricates missing artifacts.
 */
export function loadStudySources(input: LoadStudySourcesInput): LoadedStudySources {
  const repoRoot = input.repoRoot ?? process.cwd();
  const sourceKind = input.sourceKind ?? "fixture";
  const manifest = StudySourcesManifest.parse(input.manifest);

  for (const instant of manifest.evaluationInstants) {
    if (!instant.startsWith(manifest.sessionDate)) {
      throw new StudySourcesError(
        `evaluationInstant ${instant} must fall on sessionDate ${manifest.sessionDate}`,
      );
    }
  }

  const corpusPath = resolvePath(repoRoot, manifest.corpusPath);
  const corpus = validateReplayCorpus(
    ReplayCorpus.parse(readJson(corpusPath)),
  );

  const components = {
    macro: findMacro(
      corpus,
      manifest.macroArtifactId,
      manifest.corpusPath,
      sourceKind,
    ),
    marketStructure: findStructure(
      corpus,
      manifest.marketStructureSnapshotId,
      manifest.corpusPath,
      sourceKind,
    ),
    boundedStructure: manifest.boundedStructurePath
      ? boundedComponentFromSnapshot(
          BoundedGammaProviderSnapshot.parse(
            readJson(resolvePath(repoRoot, manifest.boundedStructurePath)),
          ),
          manifest.boundedStructurePath,
          sourceKind,
        )
      : ({
          status: "unavailable",
          kind: "bounded_structure",
          reason: "boundedStructurePath not supplied in manifest",
        } satisfies ArchiveComponent),
    catalystEvidence: findCatalysts(
      corpus,
      manifest.catalystArtifactIds,
      manifest.corpusPath,
      sourceKind,
    ),
  };

  return { manifest, corpus, components };
}

export function loadStudySourcesFromFile(
  manifestPath: string,
  repoRoot?: string,
): LoadedStudySources {
  const root = repoRoot ?? process.cwd();
  const fullPath = isAbsolute(manifestPath)
    ? manifestPath
    : join(root, manifestPath);
  const manifest = StudySourcesManifest.parse(readJson(fullPath));
  return loadStudySources({ manifest, repoRoot: root });
}
