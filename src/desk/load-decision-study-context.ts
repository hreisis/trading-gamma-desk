import {
  SimilarRegimeStudy,
  StudyForwardOutcome,
  StudyMatchProfile,
  StudyPipelineManifest,
} from "@/contracts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  similarRegimeStudyPath,
  studyForwardOutcomePath,
} from "@/studies/pipeline-store";
import type { PeerSessionContext } from "./build-decision-evidence-drilldown";

export interface DecisionStudyContext {
  readonly similarRegimeStudy: SimilarRegimeStudy | null;
  readonly peerSessions: readonly PeerSessionContext[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadSimilarRegimeStudy(
  sessionDate: string,
  symbol: string,
  dataRoot: string,
): SimilarRegimeStudy | null {
  const path = similarRegimeStudyPath(dataRoot, sessionDate, symbol);
  if (!existsSync(path)) return null;
  try {
    return SimilarRegimeStudy.parse(readJson(path));
  } catch {
    return null;
  }
}

function loadManifestProfiles(
  manifestPath: string,
  repoRoot: string,
): Map<string, StudyMatchProfile> {
  const profiles = new Map<string, StudyMatchProfile>();
  const fullPath = join(repoRoot, manifestPath);
  if (!existsSync(fullPath)) return profiles;
  try {
    const manifest = StudyPipelineManifest.parse(readJson(fullPath));
    for (const entry of manifest.similarRegime.corpus) {
      const profilePath = join(repoRoot, entry.profilePath);
      if (!existsSync(profilePath)) continue;
      const profile = StudyMatchProfile.parse(readJson(profilePath));
      profiles.set(profile.studyId, profile);
    }
  } catch {
    return profiles;
  }
  return profiles;
}

function resolvePeerPriceAsOf(
  manifestPath: string,
  repoRoot: string,
  studyId: string,
): string | null {
  const fullPath = join(repoRoot, manifestPath);
  if (!existsSync(fullPath)) return null;
  try {
    const manifest = StudyPipelineManifest.parse(readJson(fullPath));
    const entry = manifest.similarRegime.corpus.find((item) => {
      const profilePath = join(repoRoot, item.profilePath);
      if (!existsSync(profilePath)) return false;
      const profile = StudyMatchProfile.parse(readJson(profilePath));
      return profile.studyId === studyId;
    });
    return (
      entry?.priceSeriesAsOfSessionDate ??
      manifest.query.priceSeriesAsOfSessionDate
    );
  } catch {
    return null;
  }
}

function loadPeerOutcome(
  dataRoot: string,
  studyId: string,
  priceAsOf: string,
): StudyForwardOutcome | null {
  const path = studyForwardOutcomePath(dataRoot, studyId, priceAsOf);
  if (!existsSync(path)) return null;
  try {
    return StudyForwardOutcome.parse(readJson(path));
  } catch {
    return null;
  }
}

/**
 * Load similar-regime study and matched peer sessions for drill-down — exact-date only.
 * Missing artifacts yield partial drill-down (unknowns preserved); no fallback paths.
 */
export function loadDecisionStudyContext(input: {
  readonly sessionDate: string;
  readonly symbol?: string;
  readonly dataRoot?: string;
  readonly repoRoot?: string;
  readonly matchedStudyIds: readonly string[];
  readonly pipelineManifestPath?: string | null;
}): DecisionStudyContext {
  const sessionDate = input.sessionDate;
  const symbol = input.symbol ?? "SPY";
  const dataRoot = input.dataRoot ?? "data";
  const repoRoot = input.repoRoot ?? process.cwd();

  const similarRegimeStudy = loadSimilarRegimeStudy(
    sessionDate,
    symbol,
    dataRoot,
  );

  const manifestProfiles = input.pipelineManifestPath
    ? loadManifestProfiles(input.pipelineManifestPath, repoRoot)
    : new Map<string, StudyMatchProfile>();

  const peerSessions: PeerSessionContext[] = input.matchedStudyIds.map(
    (studyId) => {
      const profile = manifestProfiles.get(studyId) ?? null;
      let outcome: StudyForwardOutcome | null = null;
      if (input.pipelineManifestPath) {
        const priceAsOf = resolvePeerPriceAsOf(
          input.pipelineManifestPath,
          repoRoot,
          studyId,
        );
        if (priceAsOf) {
          outcome = loadPeerOutcome(dataRoot, studyId, priceAsOf);
        }
      }
      return { studyId, profile, outcome };
    },
  );

  return { similarRegimeStudy, peerSessions };
}
