import {
  ReplayCorpus,
  ReplayRun,
  REPLAY_METHODOLOGY_ID,
  REPLAY_METHODOLOGY_VERSION,
  REPLAY_SCHEMA_VERSION,
  type ReplayCatalystArtifact,
  type ReplayCorpus as ReplayCorpusDto,
  type ReplayFrame,
  type ReplayMacroArtifact,
  type ReplayRun as ReplayRunDto,
  type ReplaySourceRef,
  type ReplayStructureArtifact,
} from "@/contracts";
import { compareIsoInstants, parseIsoInstantMs } from "@/gamma/instant";
import { deepEqualJson } from "@/gamma/deep-equal";
import { buildReplayFrameId, unavailableReason } from "./identity";

export class ReplayCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayCorpusError";
  }
}

function assertUniqueArtifacts<T extends { artifactId: string }>(
  label: string,
  artifacts: readonly T[],
): void {
  const seen = new Map<string, T>();
  for (const artifact of artifacts) {
    const prior = seen.get(artifact.artifactId);
    if (!prior) {
      seen.set(artifact.artifactId, artifact);
      continue;
    }
    if (deepEqualJson(prior, artifact)) {
      throw new ReplayCorpusError(
        `${label} duplicate: artifactId ${artifact.artifactId} appears more than once`,
      );
    }
    throw new ReplayCorpusError(
      `${label} conflict: artifactId ${artifact.artifactId} has conflicting payloads`,
    );
  }
}

/**
 * Validate corpus: Zod shape + duplicate-identity / conflicting-payload rules.
 */
export function validateReplayCorpus(corpus: ReplayCorpusDto): ReplayCorpusDto {
  const parsed = ReplayCorpus.parse(corpus);
  assertUniqueArtifacts("macro", parsed.macro);
  assertUniqueArtifacts("marketStructure", parsed.marketStructure);
  assertUniqueArtifacts("catalystEvidence", parsed.catalystEvidence);
  return parsed;
}

function isMacroCompatible(
  artifact: ReplayMacroArtifact,
  corpus: ReplayCorpusDto,
): boolean {
  const c = corpus.macroCompatibility;
  return (
    artifact.schemaVersion === c.schemaVersion &&
    artifact.methodologyVersion === c.methodologyVersion &&
    artifact.signatureVersion === c.signatureVersion
  );
}

function isStructureCompatible(
  artifact: ReplayStructureArtifact,
  corpus: ReplayCorpusDto,
): boolean {
  const c = corpus.structureCompatibility;
  return (
    artifact.schemaVersion === c.schemaVersion &&
    artifact.methodologyId === c.methodologyId &&
    artifact.methodologyVersion === c.methodologyVersion &&
    artifact.featureMethodologyId === c.featureMethodologyId &&
    artifact.featureMethodologyVersion === c.featureMethodologyVersion &&
    artifact.underlying === c.underlying
  );
}

function isCatalystCompatible(
  artifact: ReplayCatalystArtifact,
  corpus: ReplayCorpusDto,
): boolean {
  return (
    artifact.schemaVersion === corpus.catalystCompatibility.schemaVersion
  );
}

function pickLatestByInstant<T>(
  items: readonly T[],
  instantOf: (item: T) => string,
  idOf: (item: T) => string,
): T | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => {
    const byInstant = compareIsoInstants(instantOf(b), instantOf(a));
    if (byInstant !== 0) return byInstant;
    return idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0;
  });
  return sorted[0] ?? null;
}

function selectMacro(
  corpus: ReplayCorpusDto,
  evaluationAt: string,
): ReplaySourceRef {
  const eligible = corpus.macro.filter(
    (a) =>
      isMacroCompatible(a, corpus) &&
      compareIsoInstants(a.availableAt, evaluationAt) <= 0,
  );
  if (eligible.length === 0) {
    const anyCompatible = corpus.macro.some((a) =>
      isMacroCompatible(a, corpus),
    );
    return {
      status: "unavailable",
      sourceKind: "macro",
      reason: unavailableReason(
        "macro",
        anyCompatible
          ? "no artifact available at or before evaluationAt"
          : "no compatible macro artifact in corpus",
      ),
    };
  }
  const picked = pickLatestByInstant(
    eligible,
    (a) => a.availableAt,
    (a) => a.artifactId,
  )!;
  return {
    status: "available",
    sourceKind: "macro",
    artifactId: picked.artifactId,
    availableAt: picked.availableAt,
    schemaVersion: picked.schemaVersion,
    methodologyVersion: picked.methodologyVersion,
    signatureVersion: picked.signatureVersion,
    marketSessionDate: picked.marketSessionDate,
    synthetic: picked.synthetic,
    sourceStatus: picked.status,
    limitations: [...picked.limitations],
  };
}

function selectStructure(
  corpus: ReplayCorpusDto,
  evaluationAt: string,
): ReplaySourceRef {
  const eligible = corpus.marketStructure.filter(
    (a) =>
      isStructureCompatible(a, corpus) &&
      compareIsoInstants(a.availableAt, evaluationAt) <= 0,
  );
  if (eligible.length === 0) {
    const anyCompatible = corpus.marketStructure.some((a) =>
      isStructureCompatible(a, corpus),
    );
    return {
      status: "unavailable",
      sourceKind: "market_structure",
      reason: unavailableReason(
        "market_structure",
        anyCompatible
          ? "no artifact available at or before evaluationAt"
          : "no compatible market structure artifact in corpus",
      ),
    };
  }
  const picked = pickLatestByInstant(
    eligible,
    (a) => a.availableAt,
    (a) => a.artifactId,
  )!;
  return {
    status: "available",
    sourceKind: "market_structure",
    artifactId: picked.artifactId,
    availableAt: picked.availableAt,
    schemaVersion: picked.schemaVersion,
    methodologyId: picked.methodologyId,
    methodologyVersion: picked.methodologyVersion,
    featureMethodologyId: picked.featureMethodologyId,
    featureMethodologyVersion: picked.featureMethodologyVersion,
    underlying: picked.underlying,
    snapshotId: picked.snapshotId,
    sessionDate: picked.sessionDate,
    synthetic: picked.synthetic,
    sourceStatus: picked.status,
    limitations: [...picked.limitations],
  };
}

function selectCatalyst(
  corpus: ReplayCorpusDto,
  evaluationAt: string,
): ReplaySourceRef {
  const eligible = corpus.catalystEvidence.filter(
    (a) =>
      isCatalystCompatible(a, corpus) &&
      compareIsoInstants(a.publishedAt, evaluationAt) <= 0,
  );
  if (eligible.length === 0) {
    const anyCompatible = corpus.catalystEvidence.some((a) =>
      isCatalystCompatible(a, corpus),
    );
    const anyFuture =
      anyCompatible &&
      corpus.catalystEvidence.some(
        (a) =>
          isCatalystCompatible(a, corpus) &&
          compareIsoInstants(a.publishedAt, evaluationAt) > 0,
      );
    return {
      status: "unavailable",
      sourceKind: "catalyst_evidence",
      reason: unavailableReason(
        "catalyst_evidence",
        !anyCompatible
          ? "no compatible catalyst evidence in corpus"
          : anyFuture
            ? "compatible catalyst evidence exists only after evaluationAt"
            : "no catalyst evidence published at or before evaluationAt",
      ),
    };
  }
  const picked = pickLatestByInstant(
    eligible,
    (a) => a.publishedAt,
    (a) => a.artifactId,
  )!;
  return {
    status: "available",
    sourceKind: "catalyst_evidence",
    artifactId: picked.artifactId,
    availableAt: picked.publishedAt,
    schemaVersion: picked.schemaVersion,
    catalystId: picked.catalystId,
    synthetic: picked.synthetic,
    sourceStatus: picked.status,
    limitations: [...picked.limitations],
  };
}

function uniqueSortedEvaluationAts(evaluationAts: readonly string[]): string[] {
  const byMs = new Map<number, string>();
  for (const at of evaluationAts) {
    const ms = parseIsoInstantMs(at);
    const existing = byMs.get(ms);
    if (existing !== undefined && existing !== at) {
      throw new ReplayCorpusError(
        `duplicate evaluationAt instant: ${existing} and ${at}`,
      );
    }
    byMs.set(ms, at);
  }
  return [...byMs.entries()]
    .sort((a, b) => a[0]! - b[0]!)
    .map(([, at]) => at);
}

export interface BuildReplayRunInput {
  readonly corpus: ReplayCorpusDto;
  readonly evaluationAts: readonly string[];
  readonly runId: string;
}

/**
 * Pure: construct ordered ReplayFrames from a validated corpus.
 * Uses only artifacts available at/before each evaluationAt.
 * Never recomputes or mutates historical source artifacts.
 */
export function buildReplayRun(input: BuildReplayRunInput): ReplayRunDto {
  const corpus = validateReplayCorpus(input.corpus);
  const evaluationAts = uniqueSortedEvaluationAts(input.evaluationAts);

  if (!input.runId || input.runId.length === 0) {
    throw new ReplayCorpusError("runId is required");
  }

  const frames: ReplayFrame[] = evaluationAts.map((evaluationAt) => ({
    kind: "ReplayFrame",
    frameId: buildReplayFrameId(input.runId, evaluationAt),
    evaluationAt,
    macro: selectMacro(corpus, evaluationAt),
    marketStructure: selectStructure(corpus, evaluationAt),
    catalystEvidence: selectCatalyst(corpus, evaluationAt),
  }));

  return ReplayRun.parse({
    kind: "ReplayRun",
    schemaVersion: REPLAY_SCHEMA_VERSION,
    methodologyId: REPLAY_METHODOLOGY_ID,
    methodologyVersion: REPLAY_METHODOLOGY_VERSION,
    runId: input.runId,
    frames,
  });
}
