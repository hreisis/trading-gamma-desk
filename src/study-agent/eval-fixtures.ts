import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DailyResearchArchive,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchProfile,
  buildOutcomeId,
  buildStudyId,
  type StudyMatchFactorKey,
} from "@/contracts";
import {
  buildSimilarRegimeStudy,
  buildStudyEvidenceBundle,
  buildStudyMatchProfile,
} from "@/studies";

export const EVAL_FIXTURE_SESSION = "2026-07-29";
export const EVAL_FIXTURES_DIR = "fixtures/studies/eval";

const ARCHIVE_PATH = "fixtures/studies/archive/2026-07-29/daily-research.json";
const QUERY_STUDY_ID = buildStudyId("research|2026-07-29|0.1.0", "SPY");

const MATCH_FACTORS: StudyMatchFactorKey[] = [
  "macro_regime",
  "gamma_regime",
  "bounded_gamma_availability",
  "catalyst_ids",
];

export const EVAL_CASE_IDS = [
  "supported_adequate",
  "mixed",
  "not_supported",
  "insufficient_evidence",
  "supported_thin_n1",
  "partial_horizon_mfe",
] as const;

export type EvalCaseId = (typeof EVAL_CASE_IDS)[number];

export interface EvalCaseDefinition {
  readonly id: EvalCaseId;
  readonly label: string;
  readonly expectedEvidenceStatus: StudyEvidenceBundle["evidenceStatus"];
  readonly abstains: boolean;
  readonly liveRunCount: number;
  readonly fixtureFile: string;
}

export const EVAL_CASES: readonly EvalCaseDefinition[] = [
  {
    id: "supported_adequate",
    label: "Supported with adequate cohort (n=3)",
    expectedEvidenceStatus: "supported",
    abstains: false,
    liveRunCount: 3,
    fixtureFile: "evidence-bundle.eval-supported-adequate.json",
  },
  {
    id: "mixed",
    label: "Mixed evidence (conflicting cohort)",
    expectedEvidenceStatus: "mixed",
    abstains: false,
    liveRunCount: 3,
    fixtureFile: "evidence-bundle.eval-mixed.json",
  },
  {
    id: "not_supported",
    label: "Not supported (uniformly negative cohort)",
    expectedEvidenceStatus: "not_supported",
    abstains: false,
    liveRunCount: 3,
    fixtureFile: "evidence-bundle.eval-not-supported.json",
  },
  {
    id: "insufficient_evidence",
    label: "Insufficient evidence (no matches — abstain)",
    expectedEvidenceStatus: "insufficient_evidence",
    abstains: true,
    liveRunCount: 1,
    fixtureFile: "evidence-bundle.eval-insufficient.json",
  },
  {
    id: "supported_thin_n1",
    label: "Supported but thin cohort (n=1)",
    expectedEvidenceStatus: "supported",
    abstains: false,
    liveRunCount: 3,
    fixtureFile: "evidence-bundle.eval-supported-thin-n1.json",
  },
  {
    id: "partial_horizon_mfe",
    label: "Supported with partial 20D horizon and sparse MFE/MAE",
    expectedEvidenceStatus: "supported",
    abstains: false,
    liveRunCount: 3,
    fixtureFile: "evidence-bundle.eval-partial-horizon-mfe.json",
  },
];

function loadArchive() {
  return DailyResearchArchive.parse(
    JSON.parse(readFileSync(join(process.cwd(), ARCHIVE_PATH), "utf8")),
  );
}

function queryProfile(gammaRegime = "positive") {
  return buildStudyMatchProfile({
    studyId: QUERY_STUDY_ID,
    sessionDate: EVAL_FIXTURE_SESSION,
    archive: loadArchive(),
    enrichment: { gammaRegime },
  });
}

function makeProfile(studyId: string, sessionDate: string): StudyMatchProfile {
  const base = queryProfile();
  return StudyMatchProfile.parse({
    kind: "StudyMatchProfile",
    schemaVersion: "0.1.0",
    studyId,
    sessionDate,
    fields: base.fields,
  });
}

type ReturnTriplet = { d1: number; d5: number; d20: number };

interface OutcomeOptions {
  readonly returns: ReturnTriplet;
  readonly d20Mature?: boolean;
  readonly d5Excursion?: "available" | "unavailable";
}

function matureOutcome(
  studyId: string,
  sessionDate: string,
  options: OutcomeOptions,
): StudyForwardOutcome {
  const asOf = "2026-08-29";
  const { returns, d20Mature = true, d5Excursion = "unavailable" } = options;
  const d20Maturity = d20Mature
    ? {
        horizon: "20D" as const,
        requiredSessions: 20,
        sessionsAvailable: 20,
        status: "mature" as const,
        exitSessionDate: sessionDate,
      }
    : {
        horizon: "20D" as const,
        requiredSessions: 20,
        sessionsAvailable: 8,
        status: "immature" as const,
        reason: "eval fixture — 20D not mature",
      };

  const d20Return = d20Mature
    ? {
        status: "available" as const,
        value: returns.d20,
        entryPrice: 100,
        exitPrice: 100 * (1 + returns.d20),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 20,
      }
    : {
        status: "unavailable" as const,
        reason: "20D horizon immature",
      };

  const d5Exc =
    d5Excursion === "available"
      ? {
          status: "available" as const,
          mfe: Math.max(returns.d5 * 1.5, 0.005),
          mae: Math.min(returns.d5 * -0.5, -0.002),
          entrySessionDate: sessionDate,
          windowEndSessionDate: sessionDate,
          sessionsObserved: 5,
        }
      : { status: "unavailable" as const, reason: "eval fixture" };

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
      d20Maturity,
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
      d20: d20Return,
    },
    excursion: {
      d1: { status: "unavailable", reason: "eval fixture" },
      d5: d5Exc,
      d20: { status: "unavailable", reason: "eval fixture" },
    },
    limitations: ["Synthetic study-memo eval outcome"],
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

function bundleFromStudy(study: ReturnType<typeof buildStudy>) {
  return buildStudyEvidenceBundle({
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
}

/** Build contract-valid eval bundle for a named case. */
export function buildEvalCaseBundle(caseId: EvalCaseId): StudyEvidenceBundle {
  switch (caseId) {
    case "supported_adequate": {
      const peers = ["a", "b", "c"].map((id) => {
        const studyId = `study|eval-peer-${id}|SPY|0.1.0`;
        const sessionDate = `2026-07-${20 + id.charCodeAt(0) - 97}`;
        return {
          profile: makeProfile(studyId, sessionDate),
          outcome: matureOutcome(studyId, sessionDate, {
            returns: { d1: 0.01, d5: 0.025, d20: 0.04 },
          }),
        };
      });
      return bundleFromStudy(buildStudy(peers));
    }
    case "mixed": {
      return bundleFromStudy(
        buildStudy([
          {
            profile: makeProfile("study|eval-mixed-pos|SPY|0.1.0", "2026-07-22"),
            outcome: matureOutcome(
              "study|eval-mixed-pos|SPY|0.1.0",
              "2026-07-22",
              { returns: { d1: 0.02, d5: 0.04, d20: 0.06 } },
            ),
          },
          {
            profile: makeProfile("study|eval-mixed-neg|SPY|0.1.0", "2026-07-15"),
            outcome: matureOutcome(
              "study|eval-mixed-neg|SPY|0.1.0",
              "2026-07-15",
              { returns: { d1: -0.02, d5: -0.04, d20: -0.06 } },
            ),
          },
        ]),
      );
    }
    case "not_supported": {
      const dates = ["2026-07-20", "2026-07-21", "2026-07-22"];
      const peers = dates.map((sessionDate, index) => {
        const studyId = `study|eval-neg-${index}|SPY|0.1.0`;
        return {
          profile: makeProfile(studyId, sessionDate),
          outcome: matureOutcome(studyId, sessionDate, {
            returns: { d1: -0.01, d5: -0.03, d20: -0.05 },
          }),
        };
      });
      return bundleFromStudy(buildStudy(peers));
    }
    case "insufficient_evidence":
      return bundleFromStudy(buildStudy([]));
    case "supported_thin_n1":
      return bundleFromStudy(
        buildStudy([
          {
            profile: makeProfile("study|eval-thin-n1|SPY|0.1.0", "2026-07-22"),
            outcome: matureOutcome(
              "study|eval-thin-n1|SPY|0.1.0",
              "2026-07-22",
              { returns: { d1: 0.01, d5: 0.02, d20: 0.03 } },
            ),
          },
        ]),
      );
    case "partial_horizon_mfe": {
      const peers = ["a", "b", "c"].map((id, index) => {
        const studyId = `study|eval-partial-${id}|SPY|0.1.0`;
        const sessionDate = "2026-07-22";
        return {
          profile: makeProfile(studyId, sessionDate),
          outcome: matureOutcome(studyId, sessionDate, {
            returns: { d1: 0.008, d5: 0.022, d20: 0.03 },
            d20Mature: false,
            d5Excursion: index === 0 ? "available" : "unavailable",
          }),
        };
      });
      return bundleFromStudy(buildStudy(peers));
    }
    default: {
      const _exhaustive: never = caseId;
      throw new Error(`unknown eval case: ${_exhaustive}`);
    }
  }
}

export function evalCaseById(caseId: EvalCaseId): EvalCaseDefinition {
  const found = EVAL_CASES.find((c) => c.id === caseId);
  if (!found) throw new Error(`unknown eval case: ${caseId}`);
  return found;
}

export function writeEvalFixtures(rootDir = process.cwd()): void {
  const dir = join(rootDir, EVAL_FIXTURES_DIR);
  mkdirSync(dir, { recursive: true });
  for (const evalCase of EVAL_CASES) {
    const bundle = buildEvalCaseBundle(evalCase.id);
    if (bundle.evidenceStatus !== evalCase.expectedEvidenceStatus) {
      throw new Error(
        `${evalCase.id}: expected evidenceStatus ${evalCase.expectedEvidenceStatus}, got ${bundle.evidenceStatus}`,
      );
    }
    const path = join(dir, evalCase.fixtureFile);
    writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  }
}

export function readEvalFixtureBundle(
  caseId: EvalCaseId,
  rootDir = process.cwd(),
): StudyEvidenceBundle {
  const evalCase = evalCaseById(caseId);
  const path = join(rootDir, EVAL_FIXTURES_DIR, evalCase.fixtureFile);
  return StudyEvidenceBundle.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
}
