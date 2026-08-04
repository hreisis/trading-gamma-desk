import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  RULE_BASED_MEMO_PROVIDER,
  buildRuleBasedMemoOutput,
  createFakeStudyMemoNarrator,
  createOpenAiStudyMemoNarrator,
  parseStudyMemoCliArgs,
  readStudyEvidenceBundle,
  runStudyMemoCli,
  runStudyMemoWorkflow,
  studyMemoPath,
  validateStudyMemoOutput,
  writeStudyMemo,
} from "@/study-agent";

const ARCHIVE_PATH =
  "fixtures/studies/archive/2026-07-29/daily-research.json";
const FIXTURE_BUNDLE = "fixtures/studies/evidence-bundle.m62.json";
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

function queryProfile() {
  return buildStudyMatchProfile({
    studyId: QUERY_STUDY_ID,
    sessionDate: "2026-07-29",
    archive: loadArchive(),
    enrichment: { gammaRegime: "positive" },
  });
}

function supportedBundle() {
  const peer = StudyMatchProfile.parse({
    kind: "StudyMatchProfile",
    schemaVersion: "0.1.0",
    studyId: "study|peer-m62|SPY|0.1.0",
    sessionDate: "2026-07-22",
    fields: queryProfile().fields,
  });
  const asOf = "2026-08-29";
  const studyId = "study|peer-m62|SPY|0.1.0";
  const outcome = StudyForwardOutcome.parse({
    kind: "StudyForwardOutcome",
    schemaVersion: "0.1.0",
    outcomeId: buildOutcomeId(studyId, asOf),
    studyId,
    archiveId: "research|2026-07-22|0.1.0",
    sessionDate: "2026-07-22",
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
        exitSessionDate: "2026-07-22",
      },
      {
        horizon: "5D",
        requiredSessions: 5,
        sessionsAvailable: 5,
        status: "mature",
        exitSessionDate: "2026-07-22",
      },
      {
        horizon: "20D",
        requiredSessions: 20,
        sessionsAvailable: 20,
        status: "mature",
        exitSessionDate: "2026-07-22",
      },
    ],
    returns: {
      d1: {
        status: "available",
        value: 0.01,
        entryPrice: 100,
        exitPrice: 101,
        entrySessionDate: "2026-07-22",
        exitSessionDate: "2026-07-22",
        horizonSessions: 1,
      },
      d5: {
        status: "available",
        value: 0.02,
        entryPrice: 100,
        exitPrice: 102,
        entrySessionDate: "2026-07-22",
        exitSessionDate: "2026-07-22",
        horizonSessions: 5,
      },
      d20: {
        status: "available",
        value: 0.04,
        entryPrice: 100,
        exitPrice: 104,
        entrySessionDate: "2026-07-22",
        exitSessionDate: "2026-07-22",
        horizonSessions: 20,
      },
    },
    excursion: {
      d1: { status: "unavailable", reason: "fixture" },
      d5: { status: "unavailable", reason: "fixture" },
      d20: { status: "unavailable", reason: "fixture" },
    },
    limitations: ["Synthetic M6-2 fixture outcome"],
    pitIsolation: true,
  });
  const study = buildSimilarRegimeStudy({
    queryProfile: queryProfile(),
    corpus: [{ profile: peer, outcome }],
    criteria: {
      factors: MATCH_FACTORS,
      excludeQueryStudy: true,
      minMatureSampleSize: 1,
    },
    computedAt: "2026-08-30T12:00:00.000Z",
  });
  return buildStudyEvidenceBundle({ similarRegimeStudy: study, symbol: "SPY" });
}

describe("M6-2 rule-based fallback", () => {
  it("builds validated memo output without LLM", () => {
    const bundle = supportedBundle();
    const memo = validateStudyMemoOutput({
      bundle,
      output: buildRuleBasedMemoOutput(bundle),
      provider: RULE_BASED_MEMO_PROVIDER,
      model: "study_memo_rule_v1",
      generatedAt: "2026-08-30T12:00:00.000Z",
      synthetic: true,
    });
    expect(memo.status).toBe("complete");
    expect(memo.provider).toBe(RULE_BASED_MEMO_PROVIDER);
    expect(memo.evidence.length).toBeGreaterThan(0);
    expect(memo.inference.length).toBeGreaterThan(0);
  });

  it("uses rule-based fallback when OpenAI is not configured", async () => {
    const bundle = supportedBundle();
    const result = await runStudyMemoWorkflow({
      bundle,
      config: { apiKey: null },
      synthetic: true,
    });
    expect(result.source).toBe("rule_based_fallback");
    expect(result.memo.status).toBe("complete");
    expect(result.memo.provider).toBe(RULE_BASED_MEMO_PROVIDER);
  });

  it("falls back when OpenAI output is rejected", async () => {
    const bundle = supportedBundle();
    const result = await runStudyMemoWorkflow({
      bundle,
      narrator: createFakeStudyMemoNarrator("bad_citation"),
      synthetic: true,
    });
    expect(result.source).toBe("rule_based_fallback");
    expect(result.fallbackReason).toMatch(/unknown bundleFieldPath/i);
    expect(result.memo.provider).toBe(RULE_BASED_MEMO_PROVIDER);
    expect(result.memo.status).toBe("complete");
  });

  it("uses OpenAI when mocked fetch returns valid JSON", async () => {
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
    const result = await runStudyMemoWorkflow({
      bundle,
      narrator: createOpenAiStudyMemoNarrator({
        config: {
          apiKey: "test-key",
          model: "fake-model",
          timeoutMs: 5000,
          maxRetries: 0,
          maxOutputTokens: 800,
        },
        fetchImpl,
      }),
      synthetic: true,
    });
    expect(result.source).toBe("openai");
    expect(result.memo.provider).toBe("openai");
    expect(result.memo.status).toBe("complete");
  });

  it("abstains for insufficient evidence without fallback LLM", async () => {
    const bundle = supportedBundle();
    const insufficient = StudyEvidenceBundle.parse({
      ...bundle,
      evidenceStatus: "insufficient_evidence",
      cohortQuality: {
        ...bundle.cohortQuality,
        status: "empty",
        matchedStudyCount: 0,
        matchedStudyIds: [],
      },
    });
    const narrate = vi.fn();
    const result = await runStudyMemoWorkflow({
      bundle: insufficient,
      narrator: { providerId: "fake", narrate },
      synthetic: true,
    });
    expect(narrate).not.toHaveBeenCalled();
    expect(result.source).toBe("abstained");
    expect(result.memo.status).toBe("abstained");
  });
});

describe("M6-2 memo store & CLI", () => {
  it("loads committed evidence bundle fixture", () => {
    if (!existsSync(join(process.cwd(), FIXTURE_BUNDLE))) {
      writeFileSync(
        join(process.cwd(), FIXTURE_BUNDLE),
        JSON.stringify(supportedBundle(), null, 2),
      );
    }
    const bundle = readStudyEvidenceBundle(
      join(process.cwd(), FIXTURE_BUNDLE),
    );
    expect(StudyEvidenceBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.queryContext.sessionDate).toBe("2026-07-29");
  });

  it("requires explicit --date and --bundle", () => {
    expect(() => parseStudyMemoCliArgs([])).toThrow(/--date is required/i);
    expect(() => parseStudyMemoCliArgs(["--date", "2026-07-29"])).toThrow(
      /--bundle is required/i,
    );
  });

  it("writes memo atomically via CLI workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m62-"));
    const bundlePath = join(root, "bundle.json");
    const bundle = supportedBundle();
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

    const result = await runStudyMemoCli(
      [
        "--date",
        "2026-07-29",
        "--bundle",
        bundlePath,
        "--data-root",
        root,
      ],
      { generatedAt: "2026-08-30T12:00:00.000Z" },
    );

    expect(result.written).toBe(true);
    expect(result.source).toBe("rule_based_fallback");
    expect(result.outPath).toBe(studyMemoPath(root, "2026-07-29"));
    const saved = StudyMemo.parse(
      JSON.parse(readFileSync(result.outPath, "utf8")),
    );
    expect(saved.bundleId).toBe(bundle.bundleId);
    expect(saved.status).toBe("complete");

    const again = writeStudyMemo(result.outPath, saved);
    expect(again.id).toBe(saved.id);
  });

  it("rejects date mismatch against bundle sessionDate", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m62-bad-"));
    const bundlePath = join(root, "bundle.json");
    writeFileSync(bundlePath, JSON.stringify(supportedBundle(), null, 2));
    await expect(
      runStudyMemoCli([
        "--date",
        "2026-07-28",
        "--bundle",
        bundlePath,
        "--data-root",
        root,
      ]),
    ).rejects.toThrow(/sessionDate/);
  });
});
