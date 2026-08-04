import type {
  StudyEvidenceBundle,
  StudyMemoNarratorOutput,
} from "@/contracts";

export const RULE_BASED_MEMO_PROVIDER = "rule_based";
export const RULE_BASED_MEMO_MODEL = "study_memo_rule_v1";

/**
 * Deterministic memo body from StudyEvidenceBundle — no LLM, no new math.
 */
export function buildRuleBasedMemoOutput(
  bundle: StudyEvidenceBundle,
): StudyMemoNarratorOutput {
  const primary = bundle.horizonEvidence.d5;
  const evidence: StudyMemoNarratorOutput["evidence"] = [
    {
      id: "ev_status",
      text: `Evidence status is ${bundle.evidenceStatus}.`,
      bundleFieldPaths: ["bundle.evidenceStatus"],
    },
    {
      id: "ev_cohort",
      text: `Matched ${bundle.cohortQuality.matchedStudyCount} studies with ${bundle.cohortQuality.primaryHorizonMatureCount} mature primary outcomes.`,
      bundleFieldPaths: [
        "bundle.cohortQuality.matchedStudyCount",
        "bundle.cohortQuality.primaryHorizonMatureCount",
      ],
    },
  ];

  if (
    primary.aggregate.status === "available" &&
    primary.aggregate.meanReturn !== null
  ) {
    evidence.push({
      id: "ev_mean",
      text: `Primary horizon aggregate mean return is ${primary.aggregate.meanReturn}.`,
      bundleFieldPaths: [
        "bundle.horizonEvidence.d5.aggregate.meanReturn",
      ],
    });
  }

  if (
    primary.aggregate.status === "available" &&
    primary.aggregate.positiveRate !== null
  ) {
    evidence.push({
      id: "ev_positive_rate",
      text: `Primary horizon positive rate is ${primary.aggregate.positiveRate}.`,
      bundleFieldPaths: [
        "bundle.horizonEvidence.d5.aggregate.positiveRate",
      ],
    });
  }

  const inference: StudyMemoNarratorOutput["inference"] = [
    {
      id: "inf_rule",
      text: `Status basis rule ${bundle.statusBasis.ruleId} classifies the cohort as ${bundle.evidenceStatus} — descriptive statistics only.`,
      bundleFieldPaths: [
        "bundle.statusBasis.ruleId",
        "bundle.evidenceStatus",
      ],
    },
  ];

  const limitations: StudyMemoNarratorOutput["limitations"] =
    bundle.limitations.length > 0
      ? bundle.limitations.slice(0, 3).map((text, i) => ({
          id: `lim_${i + 1}`,
          text,
          bundleFieldPaths: ["bundle.limitations"],
        }))
      : [
          {
            id: "lim_default",
            text: "Historical cohort statistics are descriptive only — not a trade signal or forward prediction.",
            bundleFieldPaths: ["bundle.limitations"],
          },
        ];

  const unknowns: StudyMemoNarratorOutput["unknowns"] =
    bundle.cohortQuality.warnings.map((text, i) => ({
      id: `unk_warn_${i + 1}`,
      text,
      bundleFieldPaths: ["bundle.cohortQuality.warnings"],
    }));

  if (bundle.cohortQuality.status === "thin") {
    unknowns.push({
      id: "unk_thin",
      text: "Cohort sample is thin for the primary horizon.",
      bundleFieldPaths: ["bundle.cohortQuality.status"],
    });
  }

  if (bundle.cohortQuality.differentFactorCount > 0) {
    unknowns.push({
      id: "unk_factors",
      text: `${bundle.cohortQuality.differentFactorCount} matched factor(s) vary within the cohort.`,
      bundleFieldPaths: ["bundle.cohortQuality.differentFactorCount"],
    });
  }

  return {
    headline: "Rule-based similar-regime study memo",
    evidence,
    inference,
    limitations,
    unknowns,
  };
}
