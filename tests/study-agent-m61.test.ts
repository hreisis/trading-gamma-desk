import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DailyResearchArchive,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchProfile,
  StudyMemo,
  buildOutcomeId,
  buildStudyId,
  type StudyMatchFactorKey,
} from "@/contracts";
import {
  buildSimilarRegimeStudy,
  buildStudyEvidenceBundle,
  buildStudyMatchProfile,
} from "@/studies";
import {
  STUDY_MEMO_NARRATOR_JSON_SCHEMA,
  STUDY_MEMO_PROMPT_VERSION,
  STUDY_MEMO_SYSTEM_PROMPT,
  abstainStudyMemo,
  buildStudyMemo,
  buildStudyMemoInputPacket,
  buildStudyMemoUserPrompt,
  createFakeStudyMemoNarrator,
  createOpenAiStudyMemoNarrator,
  enumerateBundleFieldPaths,
  validateStudyMemoOutput,
} from "@/study-agent";

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

function matureOutcome(
  studyId: string,
  sessionDate: string,
  d5: number,
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
        value: d5 / 2,
        entryPrice: 100,
        exitPrice: 100 * (1 + d5 / 2),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 1,
      },
      d5: {
        status: "available",
        value: d5,
        entryPrice: 100,
        exitPrice: 100 * (1 + d5),
        entrySessionDate: sessionDate,
        exitSessionDate: sessionDate,
        horizonSessions: 5,
      },
      d20: {
        status: "available",
        value: d5 * 2,
        entryPrice: 100,
        exitPrice: 100 * (1 + d5 * 2),
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
    limitations: ["Synthetic M6-1 test outcome"],
    pitIsolation: true,
  });
}

function supportedBundle() {
  const peer = makeProfile("study|peer-m61|SPY|0.1.0", "2026-07-22");
  const study = buildSimilarRegimeStudy({
    queryProfile: queryProfile(),
    corpus: [
      {
        profile: peer,
        outcome: matureOutcome("study|peer-m61|SPY|0.1.0", "2026-07-22", 0.02),
      },
    ],
    criteria: {
      factors: MATCH_FACTORS,
      excludeQueryStudy: true,
      minMatureSampleSize: 1,
    },
    computedAt: "2026-08-30T12:00:00.000Z",
  });
  return buildStudyEvidenceBundle({ similarRegimeStudy: study, symbol: "SPY" });
}

function insufficientBundle() {
  const study = buildSimilarRegimeStudy({
    queryProfile: queryProfile(),
    corpus: [],
    criteria: {
      factors: MATCH_FACTORS,
      excludeQueryStudy: true,
      minMatureSampleSize: 1,
    },
    computedAt: "2026-08-30T12:00:00.000Z",
  });
  return buildStudyEvidenceBundle({ similarRegimeStudy: study, symbol: "SPY" });
}

describe("M6-1 StudyMemo contract & prompt", () => {
  it("builds input packet from evidence bundle only", () => {
    const bundle = supportedBundle();
    const packet = buildStudyMemoInputPacket(bundle);
    expect(packet.bundleId).toBe(bundle.bundleId);
    expect(packet.evidenceStatus).toBe("supported");
    expect(packet.queryMatchFields.macro_regime).toBe("fed_rates");
    expect(buildStudyMemoUserPrompt(packet)).toContain("StudyEvidenceBundle");
    expect(STUDY_MEMO_SYSTEM_PROMPT).toMatch(/do not add facts/i);
    expect(STUDY_MEMO_NARRATOR_JSON_SCHEMA.required).toContain("evidence");
  });

  it("enumerates resolvable bundle field paths", () => {
    const bundle = supportedBundle();
    const paths = enumerateBundleFieldPaths(bundle);
    expect(paths.has("bundle.evidenceStatus")).toBe(true);
    expect(paths.has("bundle.horizonEvidence.d5.aggregate.meanReturn")).toBe(
      true,
    );
  });
});

describe("M6-1 abstain on insufficient evidence", () => {
  it("abstains without calling narrator when evidence is insufficient", async () => {
    const bundle = insufficientBundle();
    expect(bundle.evidenceStatus).toBe("insufficient_evidence");
    const narrate = vi.fn();
    const memo = await buildStudyMemo({
      bundle,
      narrator: { providerId: "fake", narrate },
      synthetic: true,
    });
    expect(narrate).not.toHaveBeenCalled();
    expect(memo.status).toBe("abstained");
    expect(memo.inference).toEqual([]);
    expect(memo.evidence.length).toBeGreaterThan(0);
    expect(memo.validation.errors.join(" ")).toMatch(/abstained/i);
    expect(memo.unknowns.length).toBeGreaterThan(0);
    expect(StudyMemo.safeParse(memo).success).toBe(true);
  });

  it("produces deterministic abstain memo", () => {
    const bundle = insufficientBundle();
    const a = abstainStudyMemo({
      bundle,
      provider: "fake",
      model: "fake-model",
      generatedAt: "2026-08-30T12:00:00.000Z",
      synthetic: true,
    });
    const b = abstainStudyMemo({
      bundle,
      provider: "fake",
      model: "fake-model",
      generatedAt: "2026-08-30T12:00:00.000Z",
      synthetic: true,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("M6-1 citation validation", () => {
  it("accepts fake narrator output with valid citations", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("ok"),
      synthetic: true,
    });
    expect(memo.status).toBe("complete");
    expect(memo.evidence.length).toBeGreaterThan(0);
    expect(memo.inference.length).toBeGreaterThan(0);
    expect(memo.validation.citationsValid).toBe(true);
    expect(memo.validation.numbersValid).toBe(true);
  });

  it("rejects bad bundle field citations", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("bad_citation"),
      synthetic: true,
    });
    expect(memo.status).toBe("rejected");
    expect(memo.validation.citationsValid).toBe(false);
    expect(memo.validation.errors.join(" ")).toMatch(/unknown bundleFieldPath/i);
  });

  it("rejects hallucinated numbers", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("hallucinated_number"),
      synthetic: true,
    });
    expect(memo.status).toBe("rejected");
    expect(memo.validation.numbersValid).toBe(false);
  });

  it("rejects prohibited trade language", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("prohibited"),
      synthetic: true,
    });
    expect(memo.status).toBe("rejected");
    expect(memo.validation.prohibitedInferenceDetected).toBe(true);
  });

  it("rejects prediction language", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("prediction"),
      synthetic: true,
    });
    expect(memo.status).toBe("rejected");
    expect(memo.validation.prohibitedInferenceDetected).toBe(true);
  });
});

describe("M6-1 provider interface", () => {
  it("returns unavailable when OpenAI key missing and no narrator injected", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      config: { apiKey: null },
      synthetic: true,
    });
    expect(memo.status).toBe("unavailable");
    expect(memo.evidence).toEqual([]);
    expect(memo.inference).toEqual([]);
    expect(memo.unknowns.length).toBe(1);
    expect(memo.validation.citationsValid).toBe(false);
    expect(memo.validation.errors.join(" ")).toMatch(/OPENAI_API_KEY missing/i);
  });

  it("wires OpenAI narrator without network when fetch is mocked", async () => {
    const bundle = supportedBundle();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        output_text: JSON.stringify({
          headline: "Similar-regime cohort supported",
          evidence: [
            {
              id: "ev1",
              text: "Evidence status is supported.",
              bundleFieldPaths: ["bundle.evidenceStatus"],
            },
          ],
          inference: [],
          limitations: [
            {
              id: "lim1",
              text: bundle.limitations[0]!,
              bundleFieldPaths: ["bundle.limitations"],
            },
          ],
          unknowns: [],
        }),
      }),
    );
    const narrator = createOpenAiStudyMemoNarrator({
      config: {
        apiKey: "test-key",
        model: "fake-model",
        timeoutMs: 5000,
        maxRetries: 0,
        maxOutputTokens: 800,
      },
      fetchImpl,
    });
    const memo = await buildStudyMemo({
      bundle,
      narrator,
      synthetic: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(memo.status).toBe("complete");
    expect(memo.provider).toBe("openai");
    expect(memo.promptVersion).toBe(STUDY_MEMO_PROMPT_VERSION);
  });
});

describe("M6-1 memo structure", () => {
  it("separates evidence, inference, limitations, and unknowns", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("ok"),
      synthetic: true,
    });
    expect(memo.evidence.every((b) => b.bundleFieldPaths.length > 0)).toBe(
      true,
    );
    expect(memo.inference.every((b) => b.bundleFieldPaths.length > 0)).toBe(
      true,
    );
    expect(
      memo.limitations.every((b) => b.bundleFieldPaths.length > 0),
    ).toBe(true);
  });

  it("validateStudyMemoOutput marks partial when cohort is thin", () => {
    const bundle = supportedBundle();
    const thinBundle = StudyEvidenceBundle.parse({
      ...bundle,
      cohortQuality: { ...bundle.cohortQuality, status: "thin" },
    });
    const memo = validateStudyMemoOutput({
      bundle: thinBundle,
      output: {
        headline: "Thin cohort",
        evidence: [
          {
            id: "ev1",
            text: "Evidence status is supported.",
            bundleFieldPaths: ["bundle.evidenceStatus"],
          },
        ],
        inference: [],
        limitations: [
          {
            id: "lim1",
            text: thinBundle.limitations[0]!,
            bundleFieldPaths: ["bundle.limitations"],
          },
        ],
        unknowns: [
          {
            id: "unk1",
            text: "Cohort sample is thin.",
            bundleFieldPaths: ["bundle.cohortQuality.status"],
          },
        ],
      },
      provider: "fake",
      model: "fake-model",
      generatedAt: "2026-08-30T12:00:00.000Z",
      synthetic: true,
    });
    expect(memo.status).toBe("partial");
  });
});

describe("M6-1 status distinction", () => {
  it("keeps abstained, unavailable, and rejected semantically distinct", async () => {
    const bundle = supportedBundle();
    const insufficient = insufficientBundle();

    const abstained = await buildStudyMemo({
      bundle: insufficient,
      narrator: createFakeStudyMemoNarrator("ok"),
      synthetic: true,
    });
    const unavailable = await buildStudyMemo({
      bundle,
      config: { apiKey: null },
      synthetic: true,
    });
    const rejected = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("bad_citation"),
      synthetic: true,
    });

    expect(abstained.status).toBe("abstained");
    expect(unavailable.status).toBe("unavailable");
    expect(rejected.status).toBe("rejected");

    expect(abstained.inference).toEqual([]);
    expect(abstained.evidence.length).toBeGreaterThan(0);
    expect(abstained.validation.errors.join(" ")).toMatch(/abstained/i);

    expect(unavailable.evidence).toEqual([]);
    expect(unavailable.inference).toEqual([]);
    expect(unavailable.validation.citationsValid).toBe(false);
    expect(unavailable.validation.errors.join(" ")).toMatch(/OPENAI_API_KEY/i);

    expect(rejected.evidence.length).toBeGreaterThan(0);
    expect(rejected.validation.citationsValid).toBe(false);
    expect(rejected.validation.errors.join(" ")).toMatch(
      /unknown bundleFieldPath/i,
    );
    expect(rejected.validation.errors.join(" ")).not.toMatch(/abstained/i);
    expect(rejected.validation.errors.join(" ")).not.toMatch(
      /OPENAI_API_KEY missing/i,
    );
  });
});
