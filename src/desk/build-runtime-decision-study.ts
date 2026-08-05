import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BoundedGammaProviderSnapshot,
  CatalystFeed,
  DominantDriver,
  MatchFieldValue,
  SimilarRegimeStudy,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchProfile,
  StudyMemo,
  SimilarRegimeMatchCriteria,
} from "@/contracts";
import {
  StudyForwardOutcome as StudyForwardOutcomeSchema,
  StudyMatchProfile as StudyMatchProfileSchema,
} from "@/contracts";
import { buildSimilarRegimeStudy } from "@/studies/build-similar-regime-study";
import { buildStudyEvidenceBundle } from "@/studies/build-evidence-bundle";
import { runStudyMemoWorkflow } from "@/study-agent/build-memo-workflow";
import type { PeerSessionContext } from "./build-decision-evidence-drilldown";

const RUNTIME_MATCH_CRITERIA: SimilarRegimeMatchCriteria = {
  factors: [
    "macro_regime",
    "gamma_regime",
    "bounded_gamma_availability",
    "catalyst_ids",
  ],
  excludeQueryStudy: true,
  minMatureSampleSize: 1,
};

function available(value: string): MatchFieldValue {
  return { status: "available", value };
}

function unavailable(reason: string): MatchFieldValue {
  return { status: "unavailable", reason };
}

export function buildLiveStudyMatchProfile(input: {
  readonly sessionDate: string;
  readonly symbol: string;
  readonly driver: DominantDriver;
  readonly gammaSnapshot: BoundedGammaProviderSnapshot | null;
  readonly catalystIds: readonly string[];
}): StudyMatchProfile {
  const studyId = `study|research|${input.sessionDate}|0.1.0|${input.symbol}|0.1.0`;
  const gamma = input.gammaSnapshot;
  const catalystIds = [...input.catalystIds].sort();

  return StudyMatchProfileSchema.parse({
    kind: "StudyMatchProfile",
    schemaVersion: "0.1.0",
    studyId,
    sessionDate: input.sessionDate,
    fields: {
      macro_regime: available(input.driver.primaryRegime),
      gamma_regime: gamma
        ? available(gamma.gammaRegime)
        : unavailable("bounded gamma unavailable"),
      structure_status:
        gamma && gamma.status !== "unavailable"
          ? available(gamma.status)
          : unavailable("bounded structure unavailable"),
      bounded_gamma_availability: gamma
        ? available(gamma.status)
        : unavailable("bounded gamma unavailable"),
      bounded_scope: gamma
        ? available(gamma.scope)
        : unavailable("bounded gamma unavailable"),
      catalyst_ids:
        catalystIds.length > 0
          ? available(catalystIds.join("|"))
          : unavailable("no tier-1 catalysts in feed window"),
    },
  });
}

function loadRuntimePeerCorpus(
  repoRoot: string,
): Array<{ profile: StudyMatchProfile; outcome: StudyForwardOutcome }> {
  const profile = StudyMatchProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, "fixtures/studies/profiles/peer-m62.json"),
        "utf8",
      ),
    ),
  );
  const outcome = StudyForwardOutcomeSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, "fixtures/studies/outcomes/peer-m62-outcome.json"),
        "utf8",
      ),
    ),
  );
  return [{ profile, outcome }];
}

export interface RuntimeDecisionStudyResult {
  readonly bundle: StudyEvidenceBundle;
  readonly memo: StudyMemo;
  readonly similarRegimeStudy: SimilarRegimeStudy;
  readonly peerSessions: readonly PeerSessionContext[];
  readonly queryProfile: StudyMatchProfile;
  readonly memoSource: "rule_based_fallback" | "abstained";
}

/**
 * Build historical-study evidence at request time from live observe inputs and a
 * git-tracked peer corpus. No disk study artifacts or OpenAI calls.
 */
export async function buildRuntimeDecisionStudy(input: {
  readonly sessionDate: string;
  readonly symbol: string;
  readonly driver: DominantDriver;
  readonly gammaSnapshot: BoundedGammaProviderSnapshot | null;
  readonly catalystFeed: CatalystFeed;
  readonly repoRoot?: string;
}): Promise<RuntimeDecisionStudyResult> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const computedAt = new Date().toISOString();
  const catalystIds = input.catalystFeed.catalysts.map((c) => c.id);

  const queryProfile = buildLiveStudyMatchProfile({
    sessionDate: input.sessionDate,
    symbol: input.symbol,
    driver: input.driver,
    gammaSnapshot: input.gammaSnapshot,
    catalystIds,
  });

  const corpus = loadRuntimePeerCorpus(repoRoot);
  const similarRegimeStudy = buildSimilarRegimeStudy({
    queryProfile,
    corpus,
    criteria: RUNTIME_MATCH_CRITERIA,
    computedAt,
  });

  const bundle = buildStudyEvidenceBundle({
    similarRegimeStudy,
    symbol: input.symbol,
    computedAt,
  });

  const memoWorkflow = await runStudyMemoWorkflow({
    bundle,
    forceFallback: true,
    synthetic: false,
    generatedAt: computedAt,
  });

  const peerSessions: PeerSessionContext[] = corpus.map((entry) => ({
    studyId: entry.profile.studyId,
    profile: entry.profile,
    outcome: entry.outcome,
  }));

  return {
    bundle,
    memo: memoWorkflow.memo,
    similarRegimeStudy,
    peerSessions,
    queryProfile,
    memoSource:
      memoWorkflow.source === "abstained" ? "abstained" : "rule_based_fallback",
  };
}
