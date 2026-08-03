import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DailyResearchArchive,
  SimilarRegimeStudy,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchProfile,
  buildEvidenceBundleId,
  buildOutcomeId,
  buildStudyId,
  type StudyMatchFactorKey,
} from "@/contracts";
import {
  buildSimilarRegimeStudy,
  buildStudyEvidenceBundle,
  buildStudyMatchProfile,
} from "@/studies";

const ARCHIVE_PATH =
  "fixtures/studies/archive/2026-07-29/daily-research.json";
const QUERY_STUDY_ID = buildStudyId("research|2026-07-29|0.1.0", "SPY");

const MATCH_FACTORS: StudyMatchFactorKey[] = [
  "macro_regime",
  "gamma_regime",
  "bounded_gamma_availability",
  "catalyst_ids",
];

function loadArchive() {
  return DailyResearchArchive.parse(
    JSON.parse(readFileSync(join(process.cwd(), ARCHIVE_PATH), "utf8")),
  );
}

function queryProfile(gammaRegime = "positive") {
  return buildStudyMatchProfile({
    studyId: QUERY_STUDY_ID,
    sessionDate: "2026-07-29",
    archive: loadArchive(),
    enrichment: { gammaRegime },
  });
}

type FieldOverrides = Partial<
  Record<StudyMatchFactorKey, { value: string } | { unavailable: string }>
>;

function makeProfile(
  studyId: string,
  sessionDate: string,
  overrides: FieldOverrides = {},
): StudyMatchProfile {
  const base = queryProfile();
  const fields = { ...base.fields };
  for (const [key, override] of Object.entries(overrides) as [
    StudyMatchFactorKey,
    FieldOverrides[StudyMatchFactorKey],
  ][]) {
    if (!override) continue;
    if ("value" in override) {
      fields[key] = { status: "available", value: override.value };
    } else {
      fields[key] = { status: "unavailable", reason: override.unavailable };
    }
  }
  return StudyMatchProfile.parse({
    kind: "StudyMatchProfile",
    schemaVersion: "0.1.0",
    studyId,
    sessionDate,
    fields,
  });
}

function matureOutcome(
  studyId: string,
  sessionDate: string,
  returns: { d1: number; d5: number; d20: number },
): StudyForwardOutcome {
  const asOf = "2026-08-29";
  return StudyForwardOutcome.parse({
    kind: "StudyForwardOutcome",
    schemaVersion: "0.1.0",
    outcomeId: buildOutcomeId(studyId, asOf),
    studyId,
    archiveId: `research|${sessionDate}|0.1.0`,
    sessionDate,
    symbol: "SPY",
    priceSeriesAsOfSessionDate: asOf,
    methodologyId: "forward_outcome_v1",
    methodologyVersion: "0.1.0",
    computedAt: "2026-08-30T12:00:00.000Z",
    provenance: {
      priceSourceKind: "fixture",
      relativePath: "fixtures/studies/prices/spy.m52.json",
      instrument: "SPY ETF adjClose proxy",
      synthetic: true,
    },
    maturity: [
      {
        horizon: "1D",
        requiredSessions: 1,
        sessionsAvailable: 1,
        status: "mature",
        exitSessionDate: sessionDate,
      },
      {
        horizon: "5D",
        requiredSessions: 5,
        sessionsAvailable: 5,
        status: "mature",
        exitSessionDate: sessionDate,
      },
      {
        horizon: "20D",
        requiredSessions: 20,
        sessionsAvailable: 20,
        status: "mature",
        exitSessionDate: sessionDate,
      },
    ],
    returns: {
      d1: {
        status: "available",
        value: returns.d1,
        entryPrice: 100,
        exitPrice: 100 * (1 + returns.d1),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 1,
      },
      d5: {
        status: "available",
        value: returns.d5,
        entryPrice: 100,
        exitPrice: 100 * (1 + returns.d5),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 5,
      },
      d20: {
        status: "available",
        value: returns.d20,
        entryPrice: 100,
        exitPrice: 100 * (1 + returns.d20),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 20,
      },
    },
    excursion: {
      d1: { status: "unavailable", reason: "fixture" },
      d5: { status: "unavailable", reason: "fixture" },
      d20: { status: "unavailable", reason: "fixture" },
    },
    limitations: ["Synthetic M5-4 test outcome"],
    pitIsolation: true,
  });
}

function buildStudy(
  corpus: Parameters<typeof buildSimilarRegimeStudy>[0]["corpus"],
  minMatureSampleSize = 1,
) {
  return buildSimilarRegimeStudy({
    queryProfile: queryProfile(),
    corpus,
    criteria: {
      factors: MATCH_FACTORS,
      excludeQueryStudy: true,
      minMatureSampleSize,
    },
    computedAt: "2026-08-30T12:00:00.000Z",
  });
}

describe("M5-4 StudyEvidenceBundle", () => {
  it("builds contract-valid bundle from similar-regime study", () => {
    const peer = makeProfile("study|peer-a|SPY|0.1.0", "2026-07-22");
    const study = buildStudy([
      {
        profile: peer,
        outcome: matureOutcome("study|peer-a|SPY|0.1.0", "2026-07-22", {
          d1: 0.01,
          d5: 0.02,
          d20: 0.03,
        }),
      },
    ]);
    const bundle = buildStudyEvidenceBundle({
      similarRegimeStudy: study,
      symbol: "SPY",
      sources: [
        {
          kind: "similar_regime_study",
          refId: study.studyId,
          schemaVersion: "0.1.0",
        },
        {
          kind: "daily_research_archive",
          refId: "research|2026-07-29|0.1.0",
          relativePath: ARCHIVE_PATH,
          schemaVersion: "0.1.0",
        },
      ],
    });

    expect(StudyEvidenceBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.bundleId).toBe(buildEvidenceBundleId(study.studyId));
    expect(bundle.queryContext.symbol).toBe("SPY");
    expect(bundle.matchCriteria.factors).toEqual(MATCH_FACTORS);
    expect(bundle.cohortQuality.matchedStudyCount).toBe(1);
    expect(bundle.sources.some((s) => s.kind === "daily_research_archive")).toBe(
      true,
    );
    expect(bundle.limitations.join(" ")).toMatch(/not a buy\/sell signal/i);
  });

  it("classifies supported when 5D cohort is uniformly positive", () => {
    const peers = ["a", "b", "c"].map((id) => {
      const studyId = `study|peer-${id}|SPY|0.1.0`;
      return {
        profile: makeProfile(studyId, "2026-07-22"),
        outcome: matureOutcome(studyId, "2026-07-22", {
          d1: 0.01,
          d5: 0.02,
          d20: 0.03,
        }),
      };
    });
    const study = buildStudy(peers);
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(bundle.evidenceStatus).toBe("supported");
    expect(bundle.statusBasis.ruleId).toBe("rule.supported.positive_cohort");
    expect(bundle.horizonEvidence.d5.evidenceStatus).toBe("supported");
    expect(bundle.cohortQuality.status).toBe("adequate");
  });

  it("classifies not_supported when 5D cohort is uniformly negative", () => {
    const peers = ["a", "b", "c"].map((id) => {
      const studyId = `study|peer-${id}|SPY|0.1.0`;
      return {
        profile: makeProfile(studyId, "2026-07-22"),
        outcome: matureOutcome(studyId, "2026-07-22", {
          d1: -0.01,
          d5: -0.03,
          d20: -0.05,
        }),
      };
    });
    const study = buildStudy(peers);
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(bundle.evidenceStatus).toBe("not_supported");
    expect(bundle.statusBasis.ruleId).toBe("rule.not_supported.negative_cohort");
  });

  it("classifies mixed when positive rate is in the middle band", () => {
    const positive = makeProfile("study|peer-pos|SPY|0.1.0", "2026-07-22");
    const negative = makeProfile("study|peer-neg|SPY|0.1.0", "2026-07-15");
    const study = buildStudy([
      {
        profile: positive,
        outcome: matureOutcome("study|peer-pos|SPY|0.1.0", "2026-07-22", {
          d1: 0.02,
          d5: 0.04,
          d20: 0.06,
        }),
      },
      {
        profile: negative,
        outcome: matureOutcome("study|peer-neg|SPY|0.1.0", "2026-07-15", {
          d1: -0.02,
          d5: -0.04,
          d20: -0.06,
        }),
      },
    ]);
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(bundle.evidenceStatus).toBe("mixed");
    expect(bundle.statusBasis.ruleId).toBe("rule.mixed.conflicting_or_weak");
    expect(bundle.horizonEvidence.d5.aggregate.positiveRate).toBe(0.5);
  });

  it("returns insufficient_evidence when no matches", () => {
    const study = buildStudy([]);
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(bundle.evidenceStatus).toBe("insufficient_evidence");
    expect(bundle.cohortQuality.status).toBe("empty");
    expect(bundle.statusBasis.ruleId).toBe("rule.insufficient.no_matches");
  });

  it("returns insufficient_evidence when primary horizon lacks mature sample", () => {
    const peer = makeProfile("study|peer-thin|SPY|0.1.0", "2026-07-22");
    const study = buildStudy(
      [
        {
          profile: peer,
          outcome: matureOutcome("study|peer-thin|SPY|0.1.0", "2026-07-22", {
            d1: 0.01,
            d5: 0.02,
            d20: 0.03,
          }),
        },
      ],
      3,
    );
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(bundle.evidenceStatus).toBe("insufficient_evidence");
    expect(bundle.cohortQuality.status).toBe("thin");
    expect(bundle.statusBasis.ruleId).toBe("rule.insufficient.horizon_data");
    expect(bundle.cohortQuality.warnings.join(" ")).toMatch(
      /minMatureSampleSize=3/i,
    );
  });

  it("preserves M5-3 warnings in cohortQuality", () => {
    const peer = makeProfile("study|peer-warn|SPY|0.1.0", "2026-07-22");
    const study = buildStudy([{ profile: peer }]);
    const bundle = buildStudyEvidenceBundle({ similarRegimeStudy: study });

    expect(study.warnings.length).toBeGreaterThan(0);
    expect(bundle.cohortQuality.warnings).toEqual(study.warnings);
  });

  it("is deterministic for identical inputs", () => {
    const peer = makeProfile("study|peer-det|SPY|0.1.0", "2026-07-22");
    const study = buildStudy([
      {
        profile: peer,
        outcome: matureOutcome("study|peer-det|SPY|0.1.0", "2026-07-22", {
          d1: 0.01,
          d5: 0.02,
          d20: 0.03,
        }),
      },
    ]);
    const input = { similarRegimeStudy: study, symbol: "SPY" as const };
    expect(JSON.stringify(buildStudyEvidenceBundle(input))).toBe(
      JSON.stringify(buildStudyEvidenceBundle(input)),
    );
  });
});

describe("M5-4 integration from M5-3 pipeline", () => {
  it("end-to-end: match profile → similar regime → evidence bundle", () => {
    const peer = makeProfile("study|peer-e2e|SPY|0.1.0", "2026-07-22");
    const study = buildSimilarRegimeStudy({
      queryProfile: queryProfile(),
      corpus: [
        {
          profile: peer,
          outcome: matureOutcome("study|peer-e2e|SPY|0.1.0", "2026-07-22", {
            d1: 0.01,
            d5: 0.025,
            d20: 0.04,
          }),
        },
      ],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(SimilarRegimeStudy.safeParse(study).success).toBe(true);

    const bundle = buildStudyEvidenceBundle({
      similarRegimeStudy: study,
      symbol: "SPY",
    });
    expect(bundle.horizonEvidence.d5.aggregate.meanReturn).toBeCloseTo(0.025, 6);
    expect(bundle.queryContext.matchProfile.studyId).toBe(QUERY_STUDY_ID);
  });
});
