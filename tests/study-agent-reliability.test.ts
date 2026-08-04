import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
import {
  buildCitationCatalog,
  buildStudyMemo,
  buildStudyMemoHeadline,
  buildStudyMemoInputPacket,
  createFakeStudyMemoNarrator,
  createOpenAiStudyMemoNarrator,
  createRetryFakeStudyMemoNarrator,
  extractOutputText,
  parseOpenAiStudyMemoResponse,
  resolveStudyMemoNarratorOutput,
  runStudyMemoWorkflow,
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

function supportedBundle() {
  const peer = makeProfile("study|peer-rel|SPY|0.1.0", "2026-07-22");
  const study = buildSimilarRegimeStudy({
    queryProfile: buildStudyMatchProfile({
      studyId: QUERY_STUDY_ID,
      sessionDate: "2026-07-29",
      archive: loadArchive(),
      enrichment: { gammaRegime: "positive" },
    }),
    corpus: [
      {
        profile: peer,
        outcome: matureOutcome("study|peer-rel|SPY|0.1.0", "2026-07-22", 0.02),
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

function makeProfile(studyId: string, sessionDate: string): StudyMatchProfile {
  const base = buildStudyMatchProfile({
    studyId: QUERY_STUDY_ID,
    sessionDate: "2026-07-29",
    archive: loadArchive(),
    enrichment: { gammaRegime: "positive" },
  });
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
    limitations: ["Synthetic reliability test outcome"],
    pitIsolation: true,
  });
}

describe("study memo citation catalog reliability", () => {
  it("exposes limitations as whole-field catalog entry without indexed paths", () => {
    const bundle = supportedBundle();
    const catalog = buildCitationCatalog(bundle);
    expect(catalog.idToPath.get("limitations")).toBe("bundle.limitations");
    expect(
      catalog.entries.some((entry) => entry.path.includes("[")),
    ).toBe(false);
  });

  it("maps symbol to canonical bundle.queryContext.symbol path", () => {
    const bundle = supportedBundle();
    const catalog = buildCitationCatalog(bundle);
    expect(catalog.idToPath.get("symbol")).toBe("bundle.queryContext.symbol");
    expect(
      catalog.entries.some((entry) => entry.path === "bundle.symbol"),
    ).toBe(false);
  });

  it("maps match profile fields to canonical paths, not queryMatchFields aliases", () => {
    const bundle = supportedBundle();
    const catalog = buildCitationCatalog(bundle);
    const macro = catalog.idToPath.get("match_macro_regime");
    expect(macro).toBe(
      "bundle.queryContext.matchProfile.fields.macro_regime",
    );
    expect(
      [...catalog.idToPath.values()].some((path) =>
        path.includes("queryMatchFields"),
      ),
    ).toBe(false);
  });

  it("rejects unknown citation IDs during resolution", () => {
    const bundle = supportedBundle();
    const packet = buildStudyMemoInputPacket(bundle);
    const catalog = buildCitationCatalog(bundle);
    const resolved = resolveStudyMemoNarratorOutput({
      packet,
      catalog,
      raw: {
        evidence: [
          {
            id: "ev1",
            text: "bad",
            citationIds: ["does_not_exist"],
          },
        ],
        inference: [],
        limitations: [],
        unknowns: [],
      },
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.errors.join(" ")).toMatch(/unknown citationId/);
    }
  });

  it("persists canonical bundleFieldPaths after resolution", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("ok"),
      synthetic: true,
    });
    expect(memo.status).toBe("complete");
    expect(memo.evidence[0]?.bundleFieldPaths).toContain("bundle.evidenceStatus");
    expect(memo.evidence[0]?.bundleFieldPaths).toContain("bundle.primaryHorizon");
    expect(
      memo.limitations.some((bullet) =>
        bullet.bundleFieldPaths.includes("bundle.limitations"),
      ),
    ).toBe(true);
    expect(
      memo.evidence.every((bullet) =>
        bullet.bundleFieldPaths.every((path) => path.startsWith("bundle.")),
      ),
    ).toBe(true);
  });

  it("applies deterministic headline template per evidenceStatus", async () => {
    const bundle = supportedBundle();
    const memo = await buildStudyMemo({
      bundle,
      narrator: createFakeStudyMemoNarrator("ok"),
      synthetic: true,
    });
    expect(memo.headline).toBe(
      buildStudyMemoHeadline({
        evidenceStatus: bundle.evidenceStatus,
        primaryHorizon: bundle.primaryHorizon,
        symbol: bundle.queryContext.symbol,
      }),
    );
  });
});

describe("study memo provider parse retry", () => {
  it("retries malformed first response then succeeds", async () => {
    const bundle = supportedBundle();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response("not-json", { status: 200 });
      }
      const modelJson = JSON.stringify({
        evidence: [
          {
            id: "ev1",
            text: `Evidence status is ${bundle.evidenceStatus} with primary horizon ${bundle.primaryHorizon}.`,
            citationIds: ["evidence_status", "primary_horizon"],
          },
        ],
        inference: [],
        limitations: [
          {
            id: "lim1",
            text: bundle.limitations[0]!,
            citationIds: ["limitations"],
          },
        ],
        unknowns: [],
      });
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: modelJson }],
            },
          ],
        }),
        { status: 200 },
      );
    });

    const packet = buildStudyMemoInputPacket(bundle);
    const parsed = await parseOpenAiStudyMemoResponse({
      fetchImpl,
      apiUrl: "https://example.test/v1/responses",
      apiKey: "test-key",
      model: "fake",
      packet,
      timeoutMs: 5000,
      maxOutputTokens: 1200,
      parseRetries: 1,
    });

    expect(calls).toBe(2);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.attempts).toBe(2);
    }
  });

  it("does not retry grounded semantic rejection from fake narrator", async () => {
    const bundle = supportedBundle();
    const narrator = createFakeStudyMemoNarrator("prohibited");
    const narrated = await narrator.narrate(buildStudyMemoInputPacket(bundle));
    expect(narrated.ok).toBe(true);
    if (!narrated.ok) return;
    const memo = validateStudyMemoOutput({
      bundle,
      output: narrated.output,
      provider: narrated.provider,
      model: narrated.model,
      generatedAt: bundle.computedAt,
      synthetic: true,
    });
    expect(memo.status).toBe("rejected");
    expect(narrated.attempts).toBe(1);
  });

  it("abstains with zero provider calls for insufficient evidence", async () => {
    const study = buildSimilarRegimeStudy({
      queryProfile: buildStudyMatchProfile({
        studyId: QUERY_STUDY_ID,
        sessionDate: "2026-07-29",
        archive: loadArchive(),
        enrichment: { gammaRegime: "positive" },
      }),
      corpus: [],
      criteria: {
        factors: MATCH_FACTORS,
        excludeQueryStudy: true,
        minMatureSampleSize: 1,
      },
      computedAt: "2026-08-30T12:00:00.000Z",
    });
    const bundle = buildStudyEvidenceBundle({
      similarRegimeStudy: study,
      symbol: "SPY",
    });
    const narrate = vi.fn();
    const result = await runStudyMemoWorkflow({
      bundle,
      narrator: { providerId: "fake", narrate },
      forceFallback: false,
      synthetic: true,
    });
    expect(result.source).toBe("abstained");
    expect(result.memo.status).toBe("abstained");
    expect(narrate).not.toHaveBeenCalled();
  });
});

describe("openai narrator citation resolution integration", () => {
  it("resolves catalog IDs through createOpenAiStudyMemoNarrator with mock fetch", async () => {
    const bundle = supportedBundle();
    const packet = buildStudyMemoInputPacket(bundle);
    const modelJson = JSON.stringify({
      evidence: [
        {
          id: "ev1",
          text: `Evidence status is ${bundle.evidenceStatus} on ${bundle.primaryHorizon}.`,
          citationIds: ["evidence_status", "primary_horizon", "symbol"],
        },
      ],
      inference: [],
      limitations: [
        {
          id: "lim1",
          text: bundle.limitations[0]!,
          citationIds: ["limitations"],
        },
      ],
      unknowns: [],
    });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: modelJson }],
          },
        ],
      }),
    );
    const narrator = createOpenAiStudyMemoNarrator({
      config: {
        apiKey: "test-key",
        model: "fake",
        timeoutMs: 5000,
        maxRetries: 0,
        maxOutputTokens: 1200,
        parseRetries: 0,
      },
      fetchImpl,
      apiUrl: "https://example.test/v1/responses",
    });
    const result = await narrator.narrate(packet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.evidence[0]?.bundleFieldPaths).toContain(
      "bundle.queryContext.symbol",
    );
    expect(extractOutputText({ output_text: modelJson })).toBe(modelJson);
  });
});
