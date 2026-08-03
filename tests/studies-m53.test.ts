import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DailyResearchArchive,
  SimilarRegimeStudy,
  StudyForwardOutcome,
  StudyMatchProfile,
  buildOutcomeId,
  buildStudyId,
  type StudyMatchFactorKey,
} from "@/contracts";
import {
  buildSimilarRegimeStudy,
  buildStudyDefinition,
  buildStudyForwardOutcome,
  buildStudyMatchProfile,
  matchFieldEquals,
} from "@/studies";

const ARCHIVE_PATH =
  "fixtures/studies/archive/2026-07-29/daily-research.json";
const PRICE_PATH = "fixtures/studies/prices/spy.m52.json";
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

function loadPrices() {
  return JSON.parse(readFileSync(join(process.cwd(), PRICE_PATH), "utf8"));
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
  excursion: { d5: { mfe: number; mae: number } },
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
      relativePath: PRICE_PATH,
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
      d5: {
        status: "available",
        mfe: excursion.d5.mfe,
        mae: excursion.d5.mae,
        entrySessionDate: sessionDate,
        windowEndSessionDate: sessionDate,
        sessionsObserved: 5,
      },
      d20: { status: "unavailable", reason: "fixture" },
    },
    limitations: ["Synthetic M5-3 test outcome"],
    pitIsolation: true,
  });
}

describe("M5-3 StudyMatchProfile", () => {
  it("extracts explicit PIT macro/catalyst/gamma fields from archive", () => {
    const profile = queryProfile();
    expect(StudyMatchProfile.safeParse(profile).success).toBe(true);
    expect(profile.fields.macro_regime).toEqual({
      status: "available",
      value: "fed_rates",
    });
    expect(profile.fields.structure_status).toEqual({
      status: "available",
      value: "available",
    });
    expect(profile.fields.bounded_gamma_availability).toEqual({
      status: "available",
      value: "incomplete",
    });
    expect(profile.fields.bounded_scope).toEqual({
      status: "available",
      value: "bounded_single_expiry",
    });
    expect(profile.fields.catalyst_ids).toEqual({
      status: "available",
      value: "syn-cpi-2026-07-15|syn-fomc-2026-07-30",
    });
    expect(profile.fields.gamma_regime).toEqual({
      status: "available",
      value: "positive",
    });
  });

  it("preserves gamma_regime as unavailable without explicit enrichment", () => {
    const profile = buildStudyMatchProfile({
      studyId: QUERY_STUDY_ID,
      sessionDate: "2026-07-29",
      archive: loadArchive(),
    });
    expect(profile.fields.gamma_regime.status).toBe("unavailable");
  });

  it("rejects match when either side is unavailable", () => {
    const q = makeProfile("study|q", "2026-07-29", {
      gamma_regime: { unavailable: "missing" },
    });
    const c = makeProfile("study|c", "2026-07-28", {
      gamma_regime: { value: "positive" },
    });
    const cmp = matchFieldEquals(q.fields.gamma_regime!, c.fields.gamma_regime!);
    expect(cmp.ok).toBe(false);
    if (!cmp.ok) expect(cmp.reason).toMatch(/query field unavailable/i);
  });
});

describe("M5-3 similar-regime study", () => {
  it("matches only on explicit PIT factors — outcomes never affect matching", () => {
    const query = queryProfile();
    const peerA = makeProfile("study|peer-a|SPY|0.1.0", "2026-07-22");
    const peerB = makeProfile("study|peer-b|SPY|0.1.0", "2026-07-15", {
      macro_regime: { value: "risk_sentiment" },
    });
    const peerC = makeProfile("study|peer-c|SPY|0.1.0", "2026-07-08");

    const highReturn = matureOutcome(
      "study|peer-c|SPY|0.1.0",
      "2026-07-08",
      { d1: 0.5, d5: 0.5, d20: 0.5 },
      { d5: { mfe: 0.6, mae: -0.01 } },
    );
    const lowReturn = matureOutcome(
      "study|peer-a|SPY|0.1.0",
      "2026-07-22",
      { d1: -0.02, d5: 0.01, d20: 0.03 },
      { d5: { mfe: 0.02, mae: -0.03 } },
    );

    const study = buildSimilarRegimeStudy({
      queryProfile: query,
      corpus: [
        { profile: query, outcome: lowReturn },
        { profile: peerA, outcome: lowReturn },
        { profile: peerB, outcome: highReturn },
        { profile: peerC, outcome: highReturn },
      ],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });

    expect(SimilarRegimeStudy.safeParse(study).success).toBe(true);
    expect(study.matchedStudyIds).toEqual([
      "study|peer-a|SPY|0.1.0",
      "study|peer-c|SPY|0.1.0",
    ]);
    expect(
      study.rejected.some(
        (r) =>
          r.studyId === "study|peer-b|SPY|0.1.0" &&
          r.reasons.some((x) => x.includes("macro_regime")),
      ),
    ).toBe(true);
    expect(study.aggregates.d5.meanReturn).toBeCloseTo((0.01 + 0.5) / 2, 6);
  });

  it("excludes immature horizons from aggregates", () => {
    const def = buildStudyDefinition({
      archive: loadArchive(),
      symbol: "SPY",
      archiveRelativePath: ARCHIVE_PATH,
      builtAt: "2026-07-30T12:00:00.000Z",
      synthetic: true,
    });
    const immature = buildStudyForwardOutcome({
      definition: def,
      priceSeries: loadPrices(),
      priceSeriesAsOfSessionDate: "2026-07-30",
      computedAt: "2026-07-31T12:00:00.000Z",
      priceRelativePath: PRICE_PATH,
    });
    const peer = makeProfile("study|peer-d|SPY|0.1.0", "2026-07-22");

    const study = buildSimilarRegimeStudy({
      queryProfile: queryProfile(),
      corpus: [{ profile: peer, outcome: immature }],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });

    expect(study.aggregates.d1.status).toBe("available");
    expect(study.aggregates.d5.status).toBe("insufficient_data");
    expect(study.aggregates.d20.status).toBe("insufficient_data");
    expect(study.warnings.some((w) => w.includes("5D"))).toBe(true);
  });

  it("emits insufficient_data when mature sample below threshold", () => {
    const peer = makeProfile("study|peer-e|SPY|0.1.0", "2026-07-22");
    const outcome = matureOutcome(
      "study|peer-e|SPY|0.1.0",
      "2026-07-22",
      { d1: 0.01, d5: 0.02, d20: 0.03 },
      { d5: { mfe: 0.02, mae: -0.01 } },
    );

    const study = buildSimilarRegimeStudy({
      queryProfile: queryProfile(),
      corpus: [{ profile: peer, outcome }],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 2,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });

    expect(study.matchedStudyIds).toHaveLength(1);
    expect(study.aggregates.d5.status).toBe("insufficient_data");
    expect(study.aggregates.d5.meanReturn).toBeNull();
    expect(study.warnings.join(" ")).toMatch(/minMatureSampleSize=2/i);
  });

  it("is deterministic for identical inputs", () => {
    const peer = makeProfile("study|peer-f|SPY|0.1.0", "2026-07-22");
    const outcome = matureOutcome(
      "study|peer-f|SPY|0.1.0",
      "2026-07-22",
      { d1: 0.01, d5: 0.02, d20: 0.03 },
      { d5: { mfe: 0.02, mae: -0.01 } },
    );
    const input = {
      queryProfile: queryProfile(),
      corpus: [{ profile: peer, outcome }],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    };
    const a = buildSimilarRegimeStudy(input);
    const b = buildSimilarRegimeStudy(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports matchedFactors and empty differentFactors when all values equal", () => {
    const peer = makeProfile("study|peer-g|SPY|0.1.0", "2026-07-22");
    const study = buildSimilarRegimeStudy({
      queryProfile: queryProfile(),
      corpus: [{ profile: peer }],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(study.matchedFactors).toEqual(MATCH_FACTORS);
    expect(study.differentFactors).toEqual([]);
  });
});

describe("M5-3 fixture corpus", () => {
  it("loads contract-valid profiles from fixtures/studies/similar-regime-corpus.m53.json", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/studies/similar-regime-corpus.m53.json"),
        "utf8",
      ),
    );
    expect(raw.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of raw.entries) {
      expect(StudyMatchProfile.safeParse(entry.profile).success).toBe(true);
    }
  });
});
