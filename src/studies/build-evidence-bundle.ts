import {
  DEFAULT_EVIDENCE_PRIMARY_HORIZON,
  EVIDENCE_STATUS_THRESHOLDS,
  ForwardHorizon,
  StudyEvidenceBundle,
  buildEvidenceBundleId,
  type EvidenceStatus,
  type EvidenceStatusBasis,
  type HorizonEvidence,
  type HorizonOutcomeAggregate,
  type SimilarRegimeStudy,
  type StudyEvidenceBundle as StudyEvidenceBundleDto,
  type StudyEvidenceSourceRef,
} from "@/contracts";

export class StudyEvidenceBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyEvidenceBundleError";
  }
}

export interface BuildStudyEvidenceBundleInput {
  readonly similarRegimeStudy: SimilarRegimeStudy;
  readonly symbol?: string;
  readonly primaryHorizon?: ForwardHorizon;
  readonly computedAt?: string;
  readonly sources?: readonly StudyEvidenceSourceRef[];
}

const HORIZON_AGG_KEYS = {
  "1D": "d1",
  "5D": "d5",
  "20D": "d20",
} as const;

function aggregateForHorizon(
  study: SimilarRegimeStudy,
  horizon: ForwardHorizon,
): HorizonOutcomeAggregate {
  return study.aggregates[HORIZON_AGG_KEYS[horizon]];
}

function classifyHorizonEvidence(
  aggregate: HorizonOutcomeAggregate,
  horizon: ForwardHorizon,
  matchedStudyCount: number,
): { evidenceStatus: EvidenceStatus; statusBasis: EvidenceStatusBasis } {
  if (matchedStudyCount === 0) {
    return {
      evidenceStatus: "insufficient_evidence",
      statusBasis: {
        ruleId: "rule.insufficient.no_matches",
        primaryHorizon: horizon,
        medianReturn: null,
        meanReturn: null,
        positiveRate: null,
        reasons: ["matchedStudyCount=0"],
      },
    };
  }

  if (aggregate.status === "insufficient_data") {
    return {
      evidenceStatus: "insufficient_evidence",
      statusBasis: {
        ruleId: "rule.insufficient.horizon_data",
        primaryHorizon: horizon,
        medianReturn: aggregate.medianReturn,
        meanReturn: aggregate.meanReturn,
        positiveRate: aggregate.positiveRate,
        reasons: [
          aggregate.reason ??
            `matureCount=${aggregate.matureCount} below minMatureSampleSize`,
        ],
      },
    };
  }

  const { medianReturn, meanReturn, positiveRate } = aggregate;
  if (
    medianReturn === null ||
    meanReturn === null ||
    positiveRate === null
  ) {
    return {
      evidenceStatus: "insufficient_evidence",
      statusBasis: {
        ruleId: "rule.insufficient.null_metrics",
        primaryHorizon: horizon,
        medianReturn,
        meanReturn,
        positiveRate,
        reasons: ["aggregate metrics unavailable despite available status"],
      },
    };
  }

  const { positiveRateSupportedMin, positiveRateNotSupportedMax } =
    EVIDENCE_STATUS_THRESHOLDS;

  if (
    medianReturn > 0 &&
    meanReturn > 0 &&
    positiveRate >= positiveRateSupportedMin
  ) {
    return {
      evidenceStatus: "supported",
      statusBasis: {
        ruleId: "rule.supported.positive_cohort",
        primaryHorizon: horizon,
        medianReturn,
        meanReturn,
        positiveRate,
        reasons: [
          `medianReturn=${medianReturn} > 0`,
          `meanReturn=${meanReturn} > 0`,
          `positiveRate=${positiveRate} >= ${positiveRateSupportedMin}`,
        ],
      },
    };
  }

  if (
    medianReturn < 0 &&
    meanReturn < 0 &&
    positiveRate <= positiveRateNotSupportedMax
  ) {
    return {
      evidenceStatus: "not_supported",
      statusBasis: {
        ruleId: "rule.not_supported.negative_cohort",
        primaryHorizon: horizon,
        medianReturn,
        meanReturn,
        positiveRate,
        reasons: [
          `medianReturn=${medianReturn} < 0`,
          `meanReturn=${meanReturn} < 0`,
          `positiveRate=${positiveRate} <= ${positiveRateNotSupportedMax}`,
        ],
      },
    };
  }

  return {
    evidenceStatus: "mixed",
    statusBasis: {
      ruleId: "rule.mixed.conflicting_or_weak",
      primaryHorizon: horizon,
      medianReturn,
      meanReturn,
      positiveRate,
      reasons: [
        "cohort metrics do not meet supported or not_supported thresholds",
        `positiveRate band requires >= ${positiveRateSupportedMin} (supported) or <= ${positiveRateNotSupportedMax} (not_supported) with aligned mean/median sign`,
      ],
    },
  };
}

function buildHorizonEvidence(
  study: SimilarRegimeStudy,
  horizon: ForwardHorizon,
): HorizonEvidence {
  const aggregate = aggregateForHorizon(study, horizon);
  const { evidenceStatus, statusBasis } = classifyHorizonEvidence(
    aggregate,
    horizon,
    study.matchedStudyIds.length,
  );
  return {
    horizon,
    aggregate,
    evidenceStatus,
    statusBasis,
  };
}

function cohortQuality(
  study: SimilarRegimeStudy,
  primaryHorizon: ForwardHorizon,
): StudyEvidenceBundleDto["cohortQuality"] {
  const matchedStudyCount = study.matchedStudyIds.length;
  const rejectedStudyCount = study.rejected.length;
  const primaryAgg = aggregateForHorizon(study, primaryHorizon);
  const reasons: string[] = [];

  let status: StudyEvidenceBundleDto["cohortQuality"]["status"];
  if (matchedStudyCount === 0) {
    status = "empty";
    reasons.push("no studies matched PIT criteria");
  } else if (primaryAgg.status === "insufficient_data") {
    status = "thin";
    reasons.push(
      primaryAgg.reason ??
        `${primaryHorizon} matureCount=${primaryAgg.matureCount} below threshold`,
    );
  } else {
    status = "adequate";
    reasons.push(
      `${primaryHorizon} matureCount=${primaryAgg.matureCount} meets minMatureSampleSize`,
    );
  }

  if (study.differentFactors.length > 0) {
    reasons.push(
      `${study.differentFactors.length} matched factor(s) vary within cohort`,
    );
  }

  return {
    status,
    matchedStudyCount,
    rejectedStudyCount,
    matchedStudyIds: [...study.matchedStudyIds],
    differentFactorCount: study.differentFactors.length,
    primaryHorizonMatureCount: primaryAgg.matureCount,
    warnings: [...study.warnings],
    reasons,
  };
}

function defaultSources(study: SimilarRegimeStudy): StudyEvidenceSourceRef[] {
  const sources: StudyEvidenceSourceRef[] = [
    {
      kind: "similar_regime_study",
      refId: study.studyId,
      schemaVersion: study.schemaVersion,
    },
    ...study.matchedStudyIds.map(
      (refId): StudyEvidenceSourceRef => ({
        kind: "study_definition",
        refId,
        schemaVersion: "0.1.0",
      }),
    ),
  ];
  return sources;
}

/**
 * Pure: deterministic evidence bundle from SimilarRegimeStudy (M5-3).
 * Describes cohort statistics only — not a trade signal or prediction.
 */
export function buildStudyEvidenceBundle(
  input: BuildStudyEvidenceBundleInput,
): StudyEvidenceBundleDto {
  const study = input.similarRegimeStudy;
  const primaryHorizon =
    input.primaryHorizon ?? DEFAULT_EVIDENCE_PRIMARY_HORIZON;
  const computedAt = input.computedAt ?? study.computedAt;

  const horizonEvidence = {
    d1: buildHorizonEvidence(study, "1D"),
    d5: buildHorizonEvidence(study, "5D"),
    d20: buildHorizonEvidence(study, "20D"),
  };

  const primaryEvidence = horizonEvidence[HORIZON_AGG_KEYS[primaryHorizon]];

  const bundle: StudyEvidenceBundleDto = {
    kind: "StudyEvidenceBundle",
    schemaVersion: "0.1.0",
    bundleId: buildEvidenceBundleId(study.studyId),
    studyId: study.studyId,
    computedAt,
    methodologyId: "study_evidence_bundle_v1",
    methodologyVersion: "0.1.0",
    queryContext: {
      studyId: study.studyId,
      sessionDate: study.queryProfile.sessionDate,
      symbol: input.symbol,
      matchProfile: study.queryProfile,
    },
    matchCriteria: study.matchCriteria,
    cohortQuality: cohortQuality(study, primaryHorizon),
    primaryHorizon,
    horizonEvidence,
    evidenceStatus: primaryEvidence.evidenceStatus,
    statusBasis: primaryEvidence.statusBasis,
    limitations: [
      ...study.limitations,
      "Evidence status describes historical cohort statistics only — not a buy/sell signal or forward prediction.",
      "Status rules use fixed thresholds on median/mean return and positive rate; not outcome-calibrated probabilities.",
      "Insufficient-data warnings from the similar-regime study are preserved in cohortQuality.warnings.",
    ],
    sources:
      input.sources && input.sources.length > 0
        ? [...input.sources]
        : defaultSources(study),
  };

  return StudyEvidenceBundle.parse(bundle);
}
