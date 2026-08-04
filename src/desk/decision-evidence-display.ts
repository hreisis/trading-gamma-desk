import type {
  EvidenceStatus,
  HorizonOutcomeAggregate,
  StudyEvidenceBundle,
} from "@/contracts";
import type {
  DecisionEvidenceSummary,
  EvidenceStrengthDisplay,
  HorizonEvidenceDisplay,
} from "@/contracts/decision-surface";

/** Format simple return as readable percentage; null/undefined → unknown (never zero). */
export function formatStudyReturnPercent(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  const pct = value * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function formatStudyRateFraction(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function horizonDisplay(
  horizon: "1D" | "5D" | "20D",
  aggregate: HorizonOutcomeAggregate,
  evidenceStatus: EvidenceStatus,
): HorizonEvidenceDisplay {
  const insufficient = aggregate.status === "insufficient_data";
  return {
    horizon,
    dataStatus: insufficient ? "insufficient_data" : "available",
    evidenceStatus,
    matureCount: aggregate.matureCount,
    sampleSize: aggregate.sampleSize,
    meanReturn: insufficient
      ? "unknown"
      : formatStudyReturnPercent(aggregate.meanReturn),
    medianReturn: insufficient
      ? "unknown"
      : formatStudyReturnPercent(aggregate.medianReturn),
    positiveRate: insufficient
      ? "unknown"
      : formatStudyRateFraction(aggregate.positiveRate),
    meanMfe:
      aggregate.meanMfe === null || aggregate.meanMfe === undefined
        ? "unknown"
        : formatStudyReturnPercent(aggregate.meanMfe),
    meanMae:
      aggregate.meanMae === null || aggregate.meanMae === undefined
        ? "unknown"
        : formatStudyReturnPercent(aggregate.meanMae),
    unavailableReason: insufficient ? aggregate.reason ?? "insufficient_data" : undefined,
  };
}

export function evidenceStatusLabel(status: EvidenceStatus): string {
  switch (status) {
    case "supported":
      return "Supported";
    case "mixed":
      return "Mixed";
    case "not_supported":
      return "Not supported";
    case "insufficient_evidence":
      return "Insufficient evidence";
  }
}

export function evidenceStatusDistinctionNote(status: EvidenceStatus): string {
  if (status === "not_supported") {
    return "Not supported describes a mature cohort with uniformly negative statistics — distinct from insufficient evidence (no usable cohort).";
  }
  if (status === "insufficient_evidence") {
    return "Insufficient evidence means the cohort or primary horizon lacks usable mature samples — not the same as a negative (not supported) read.";
  }
  return "";
}

/**
 * Display-only evidence strength — does not change evidenceStatus classification.
 */
export function deriveEvidenceStrengthDisplay(
  bundle: StudyEvidenceBundle,
): { strength: EvidenceStrengthDisplay; strengthSummary: string } {
  const { evidenceStatus, cohortQuality, primaryHorizon } = bundle;
  const n = cohortQuality.matchedStudyCount;
  const mature = cohortQuality.primaryHorizonMatureCount;

  if (
    evidenceStatus === "insufficient_evidence" ||
    cohortQuality.status === "empty"
  ) {
    return {
      strength: "insufficient",
      strengthSummary:
        "Insufficient historical cohort — no adequate mature samples for inference.",
    };
  }

  if (evidenceStatus === "not_supported") {
    return {
      strength: "limited",
      strengthSummary:
        "Negative cohort read (not supported) — mature statistics available but do not support a positive historical pattern.",
    };
  }

  if (n === 1 && evidenceStatus === "supported") {
    return {
      strength: "preliminary",
      strengthSummary:
        "Preliminary positive evidence — single historical match (n=1).",
    };
  }

  const partialHorizon = ["d1", "d5", "d20"].some((key) => {
    const agg =
      bundle.horizonEvidence[key as keyof typeof bundle.horizonEvidence]
        .aggregate;
    return agg.status === "insufficient_data";
  });

  const sparseExcursion = ["d1", "d5", "d20"].some((key) => {
    const agg =
      bundle.horizonEvidence[key as keyof typeof bundle.horizonEvidence]
        .aggregate;
    return (
      agg.status === "available" &&
      agg.meanMfe === null &&
      agg.meanMae === null
    );
  });

  if (
    cohortQuality.status === "thin" ||
    partialHorizon ||
    sparseExcursion ||
    evidenceStatus === "mixed"
  ) {
    return {
      strength: "limited",
      strengthSummary: `Limited historical evidence — cohort n=${n}, ${primaryHorizon} mature=${mature}; review horizons and limitations before inference.`,
    };
  }

  if (cohortQuality.status === "adequate") {
    return {
      strength: "adequate",
      strengthSummary: `Adequate historical cohort — n=${n}, ${primaryHorizon} mature=${mature}.`,
    };
  }

  return {
    strength: "limited",
    strengthSummary: `Limited historical evidence — cohort n=${n}.`,
  };
}

export function buildDecisionEvidenceSummary(
  bundle: StudyEvidenceBundle,
): DecisionEvidenceSummary {
  const { strength, strengthSummary } = deriveEvidenceStrengthDisplay(bundle);
  return {
    bundleId: bundle.bundleId,
    evidenceStatus: bundle.evidenceStatus,
    evidenceStatusLabel: evidenceStatusLabel(bundle.evidenceStatus),
    evidenceStatusNote: evidenceStatusDistinctionNote(bundle.evidenceStatus),
    strengthDisplay: strength,
    strengthSummary,
    primaryHorizon: bundle.primaryHorizon,
    cohortMatchedCount: bundle.cohortQuality.matchedStudyCount,
    cohortMatureCount: bundle.cohortQuality.primaryHorizonMatureCount,
    cohortQualityStatus: bundle.cohortQuality.status,
    horizons: {
      d1: horizonDisplay(
        "1D",
        bundle.horizonEvidence.d1.aggregate,
        bundle.horizonEvidence.d1.evidenceStatus,
      ),
      d5: horizonDisplay(
        "5D",
        bundle.horizonEvidence.d5.aggregate,
        bundle.horizonEvidence.d5.evidenceStatus,
      ),
      d20: horizonDisplay(
        "20D",
        bundle.horizonEvidence.d20.aggregate,
        bundle.horizonEvidence.d20.evidenceStatus,
      ),
    },
    limitations: [...bundle.limitations],
    cohortWarnings: [...bundle.cohortQuality.warnings],
    statusBasisRuleId: bundle.statusBasis.ruleId,
  };
}

export function memoProvenanceLabel(input: {
  readonly memoStatus: string;
  readonly provider: string;
  readonly model: string;
  readonly pipelineMemoSource?: string | null;
}): { statusLabel: string; sourceLabel: string; combinedLabel: string } {
  const statusLabel = input.memoStatus;
  let sourceLabel: string;
  if (input.memoStatus === "abstained") {
    sourceLabel = "Deterministic abstain";
  } else if (input.provider === "openai") {
    sourceLabel = "OpenAI";
  } else if (
    input.pipelineMemoSource === "rule_based_fallback" ||
    input.memoStatus === "unavailable"
  ) {
    sourceLabel = "Rule-based fallback";
  } else {
    sourceLabel = "Rule-based";
  }
  const combinedLabel = `${statusLabel} · ${sourceLabel} · ${input.provider}/${input.model}`;
  return { statusLabel, sourceLabel, combinedLabel };
}
