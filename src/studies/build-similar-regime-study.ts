import {
  ForwardHorizon,
  SimilarRegimeStudy,
  type HorizonOutcomeAggregate,
  type MatchFieldValue,
  type SimilarRegimeMatchCriteria,
  type SimilarRegimeStudy as SimilarRegimeStudyDto,
  type StudyForwardOutcome,
  type StudyMatchFactorKey,
  type StudyMatchProfile,
} from "@/contracts";
import { matchFieldEquals } from "./match-profile";

export class SimilarRegimeStudyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimilarRegimeStudyError";
  }
}

export interface SimilarRegimeCorpusEntry {
  readonly profile: StudyMatchProfile;
  readonly outcome?: StudyForwardOutcome;
}

export interface BuildSimilarRegimeStudyInput {
  readonly queryProfile: StudyMatchProfile;
  readonly corpus: readonly SimilarRegimeCorpusEntry[];
  readonly criteria: SimilarRegimeMatchCriteria;
  readonly computedAt: string;
}

const HORIZON_KEYS = {
  "1D": "d1",
  "5D": "d5",
  "20D": "d20",
} as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fieldValue(
  profile: StudyMatchProfile,
  factor: StudyMatchFactorKey,
): MatchFieldValue | undefined {
  return profile.fields[factor];
}

function matchesCriteria(
  query: StudyMatchProfile,
  candidate: StudyMatchProfile,
  factors: readonly StudyMatchFactorKey[],
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  for (const factor of factors) {
    const q = fieldValue(query, factor);
    const c = fieldValue(candidate, factor);
    if (!q) {
      reasons.push(`query missing factor ${factor}`);
      continue;
    }
    if (!c) {
      reasons.push(`candidate missing factor ${factor}`);
      continue;
    }
    const cmp = matchFieldEquals(q, c);
    if (!cmp.ok) {
      reasons.push(`${factor}: ${cmp.reason}`);
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function horizonReturn(
  outcome: StudyForwardOutcome,
  horizon: ForwardHorizon,
): number | null {
  const key = HORIZON_KEYS[horizon];
  const ret = outcome.returns[key];
  if (ret.status !== "available") return null;
  const maturity = outcome.maturity.find((m) => m.horizon === horizon);
  if (maturity?.status !== "mature") return null;
  return ret.value;
}

function horizonExcursion(
  outcome: StudyForwardOutcome,
  horizon: ForwardHorizon,
): { mfe: number; mae: number } | null {
  const key = HORIZON_KEYS[horizon];
  const ex = outcome.excursion[key];
  if (ex.status !== "available") return null;
  const maturity = outcome.maturity.find((m) => m.horizon === horizon);
  if (maturity?.status !== "mature") return null;
  return { mfe: ex.mfe, mae: ex.mae };
}

function aggregateHorizon(
  outcomes: readonly StudyForwardOutcome[],
  horizon: ForwardHorizon,
  minSample: number,
): HorizonOutcomeAggregate {
  const returns: number[] = [];
  const mfes: number[] = [];
  const maes: number[] = [];

  for (const outcome of outcomes) {
    const r = horizonReturn(outcome, horizon);
    if (r !== null) returns.push(r);
    const ex = horizonExcursion(outcome, horizon);
    if (ex) {
      mfes.push(ex.mfe);
      maes.push(ex.mae);
    }
  }

  const matureCount = returns.length;
  const sampleSize = outcomes.length;

  if (matureCount < minSample) {
    return {
      horizon,
      matureCount,
      sampleSize,
      status: "insufficient_data",
      meanReturn: null,
      medianReturn: null,
      positiveRate: null,
      meanMfe: null,
      medianMfe: null,
      meanMae: null,
      medianMae: null,
      reason: `matureCount=${matureCount} < minMatureSampleSize=${minSample}`,
    };
  }

  const positiveRate = returns.filter((v) => v > 0).length / returns.length;

  return {
    horizon,
    matureCount,
    sampleSize,
    status: "available",
    meanReturn: mean(returns),
    medianReturn: median(returns),
    positiveRate,
    meanMfe: mfes.length > 0 ? mean(mfes) : null,
    medianMfe: mfes.length > 0 ? median(mfes) : null,
    meanMae: maes.length > 0 ? mean(maes) : null,
    medianMae: maes.length > 0 ? median(maes) : null,
  };
}

function computeDifferentFactors(
  matched: readonly StudyMatchProfile[],
  matchedFactors: readonly StudyMatchFactorKey[],
): SimilarRegimeStudyDto["differentFactors"] {
  const different: SimilarRegimeStudyDto["differentFactors"] = [];
  for (const factor of matchedFactors) {
    const values = new Set<string>();
    for (const profile of matched) {
      const field = fieldValue(profile, factor);
      if (field?.status === "available") values.add(field.value);
    }
    if (values.size > 1) {
      different.push({
        factor,
        distinctValues: [...values].sort(),
      });
    }
  }
  return different;
}

/**
 * Pure: deterministic similar-regime study from PIT match profiles + optional outcomes.
 * Matching uses explicit macro/catalyst/gamma fields only — outcomes never affect matching.
 */
export function buildSimilarRegimeStudy(
  input: BuildSimilarRegimeStudyInput,
): SimilarRegimeStudyDto {
  const { queryProfile, criteria } = input;
  const matchedStudyIds: string[] = [];
  const rejected: SimilarRegimeStudyDto["rejected"] = [];
  const matchedProfiles: StudyMatchProfile[] = [];
  const matchedOutcomes: StudyForwardOutcome[] = [];
  const warnings: string[] = [];

  for (const entry of input.corpus) {
    if (
      criteria.excludeQueryStudy &&
      entry.profile.studyId === queryProfile.studyId
    ) {
      rejected.push({
        studyId: entry.profile.studyId,
        reasons: ["excluded query study"],
      });
      continue;
    }

    const match = matchesCriteria(
      queryProfile,
      entry.profile,
      criteria.factors,
    );
    if (!match.ok) {
      rejected.push({
        studyId: entry.profile.studyId,
        reasons: match.reasons,
      });
      continue;
    }

    matchedStudyIds.push(entry.profile.studyId);
    matchedProfiles.push(entry.profile);
    if (entry.outcome) {
      matchedOutcomes.push(entry.outcome);
    } else {
      warnings.push(
        `matched study ${entry.profile.studyId} has no forward outcome — excluded from aggregates`,
      );
    }
  }

  matchedStudyIds.sort();

  if (matchedOutcomes.length === 0 && matchedStudyIds.length > 0) {
    warnings.push("no mature forward outcomes in matched set");
  }

  const aggregates = {
    d1: aggregateHorizon(
      matchedOutcomes,
      "1D",
      criteria.minMatureSampleSize,
    ),
    d5: aggregateHorizon(
      matchedOutcomes,
      "5D",
      criteria.minMatureSampleSize,
    ),
    d20: aggregateHorizon(
      matchedOutcomes,
      "20D",
      criteria.minMatureSampleSize,
    ),
  };

  for (const agg of [aggregates.d1, aggregates.d5, aggregates.d20]) {
    if (agg.status === "insufficient_data") {
      warnings.push(`${agg.horizon}: ${agg.reason}`);
    }
  }

  const result: SimilarRegimeStudyDto = {
    kind: "SimilarRegimeStudy",
    schemaVersion: "0.1.0",
    studyId: queryProfile.studyId,
    computedAt: input.computedAt,
    methodologyId: "similar_regime_study_v1",
    methodologyVersion: "0.1.0",
    queryProfile,
    matchCriteria: criteria,
    matchedStudyIds,
    rejected,
    matchedFactors: [...criteria.factors],
    differentFactors: computeDifferentFactors(
      matchedProfiles,
      criteria.factors,
    ),
    aggregates,
    warnings,
    limitations: [
      "Similar-regime matching is exact equality on explicit PIT fields — not ML similarity.",
      "Forward outcomes are aggregated only after matching; they never influence match selection.",
      "Unavailable match fields exclude candidates — no fabricated matches.",
    ],
  };

  return SimilarRegimeStudy.parse(result);
}
