import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/ingest/http";
import {
  collectAiStudyInputs,
  generateAiStudyWithFake,
  loadAiStudyBriefing,
  loadSyntheticAiStudyBriefing,
} from "@/ai-study";
import { buildAiStudyEvidenceCorpus } from "@/ai-study/evidence-corpus";
import { claimText } from "@/ai-study/claim-utils";
import type { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function claim(text: string, evidenceIds: string[]) {
  return { text, evidenceIds };
}

function buildGroundedOpenAiSuccessReport(
  packet: Awaited<ReturnType<typeof collectAiStudyInputs>>,
): {
  readonly report: AiStudyNarratorRawOutput;
  readonly expectedRegime: string;
} {
  const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);
  const pickId = (id: string, fallback: string) =>
    evidence.some((entry) => entry.id === id) ? id : fallback;
  const macroLabelId = pickId("macro.label", "input.macro.status");
  const macroInterpId = pickId("macro.interpretation", macroLabelId);
  const gammaStatusId = pickId("input.gamma_structure.status", "input.gamma_structure.status");
  const catalystStatusId = pickId("input.catalysts.status", "input.catalysts.status");
  const regimeEntry = evidence.find((entry) => entry.id === macroLabelId);
  const expectedRegime = regimeEntry?.value ?? "unavailable";

  const report: AiStudyNarratorRawOutput = {
    marketRegime: claim(String(expectedRegime), [macroLabelId]),
    mainDrivers: [
      claim("Dominant driver interpretation from provided macro packet.", [
        macroInterpId,
      ]),
      claim("Catalyst calendar rows supplied in the input packet only.", [
        catalystStatusId,
      ]),
    ],
    keyLevelsStructure: [
      claim(
        "Structure section references bounded gamma facts when present; otherwise marked unavailable.",
        [gammaStatusId],
      ),
    ],
    upcomingRisks: [
      claim("Upcoming catalysts limited to those explicitly listed in the input packet.", [
        catalystStatusId,
      ]),
    ],
    scenarios: {
      bull: claim(
        "Conditional path if provided macro and structure context persist without new shocks.",
        [macroLabelId, gammaStatusId],
      ),
      base: claim("Status-quo path using the supplied cross-asset and structure facts only.", [
        macroLabelId,
      ]),
      bear: claim(
        "Conditional path if catalyst or structure inputs in the packet deteriorate.",
        [catalystStatusId],
      ),
    },
  };

  return { report, expectedRegime };
}

function mockOpenAiSuccess(
  packet: Awaited<ReturnType<typeof collectAiStudyInputs>>,
): FetchLike {
  const { report } = buildGroundedOpenAiSuccessReport(packet);
  return () =>
    Promise.resolve(
      jsonResponse(200, {
        output_text: JSON.stringify(report),
      }),
    );
}

describe("collectAiStudyInputs", () => {
  it("loads public demo fixtures for macro, catalysts, gamma, and quotes", async () => {
    const packet = await collectAiStudyInputs({
      publicDemo: true,
    });

    expect(packet.inputs.find((i) => i.id === "macro")?.status).toBe("fixture");
    expect(packet.inputs.find((i) => i.id === "catalysts")?.status).toBe(
      "fixture",
    );
    expect(packet.inputs.find((i) => i.id === "gamma_structure")?.status).toBe(
      "fixture",
    );
    expect(packet.inputs.find((i) => i.id === "market_quotes")?.status).toBe(
      "fixture",
    );
    expect(JSON.stringify(packet.facts)).not.toContain("invented");
  });

  it("defaults to current NY session instead of latest macro driver date", async () => {
    const now = new Date("2026-08-04T18:00:00.000Z");
    const packet = await collectAiStudyInputs({
      env: {} as unknown as NodeJS.ProcessEnv,
      now,
    });

    expect(packet.mode).toBe("current");
    expect(packet.sessionDate).toBe("2026-08-04");
    expect(packet.blocked).toBe(false);
  });

  it("uses explicit date only in historical mode", async () => {
    const packet = await collectAiStudyInputs({
      env: {} as unknown as NodeJS.ProcessEnv,
      sessionDate: "2026-07-29",
      now: new Date("2026-08-04T18:00:00.000Z"),
    });

    expect(packet.mode).toBe("historical");
    expect(packet.sessionDate).toBe("2026-07-29");
  });
});

describe("loadAiStudyBriefing", () => {
  it("returns synthetic demo briefing without OpenAI", async () => {
    const briefing = await loadAiStudyBriefing({
      publicDemo: true,
    });

    expect(briefing.status).toBe("synthetic_demo");
    expect(briefing.mode).toBe("current");
    expect(briefing.timezone).toBe("America/New_York");
    expect(briefing.provider).toBe("synthetic_demo");
    expect(briefing.message).toBe(PUBLIC_DEMO_BANNER);
    expect(claimText(briefing.report!.scenarios.bull).length).toBeGreaterThan(0);
    expect(briefing.inputs.some((i) => i.status === "fixture")).toBe(true);
  });

  it("returns rule-based briefing when OPENAI_API_KEY is missing", async () => {
    const briefing = await loadAiStudyBriefing({
      publicDemo: false,
      env: {} as NodeJS.ProcessEnv,
      config: {
        apiKey: null,
        model: "gpt-test",
        timeoutMs: 1000,
        maxRetries: 0,
        maxOutputTokens: 500,
        parseRetries: 0,
      },
    });

    expect(briefing.status).toBe("ready");
    expect(briefing.provider).toBe("rule_based");
    expect(briefing.message).toMatch(/rule-based grounded briefing/i);
    expect(briefing.report).not.toBeNull();
    expect(claimText(briefing.report!.marketRegime).length).toBeGreaterThan(0);
  });

  it("generates briefing with fake generator in tests", async () => {
    const briefing = await loadAiStudyBriefing({
      publicDemo: false,
      useFakeGenerator: true,
      env: { OPENAI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      now: new Date("2026-08-04T18:00:00.000Z"),
    });

    expect(briefing.mode).toBe("current");
    expect(briefing.sessionDate).toBe("2026-08-04");
    expect(["ready", "partial", "error"]).toContain(briefing.status);
    expect(briefing.provider).toBe("openai");
    expect(briefing.report?.mainDrivers.length).toBeGreaterThan(0);
    expect(briefing.report?.marketRegime.evidenceIds.length).toBeGreaterThan(0);
  });

  it("falls back to rule-based briefing when OpenAI HTTP errors", async () => {
    const briefing = await loadAiStudyBriefing({
      publicDemo: false,
      env: { OPENAI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      config: {
        apiKey: "test-key",
        model: "gpt-test",
        timeoutMs: 5000,
        maxRetries: 0,
        maxOutputTokens: 500,
        parseRetries: 0,
      },
      fetchImpl: () => Promise.resolve(jsonResponse(401, { error: "bad key" })),
    });

    expect(briefing.status).toBe("ready");
    expect(briefing.provider).toBe("rule_based");
    expect(briefing.message).toMatch(/OpenAI HTTP 401/i);
    expect(briefing.message).toMatch(/rule-based grounded fallback/i);
    expect(briefing.grounding?.numbersValid).toBe(true);
  });

  it("accepts mocked OpenAI success payload", async () => {
    const env = { OPENAI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv;
    const sessionDate = "2026-07-29";
    const now = new Date("2026-08-04T18:00:00.000Z");
    const packet = await collectAiStudyInputs({
      publicDemo: false,
      sessionDate,
      env,
      now,
    });
    const { expectedRegime } = buildGroundedOpenAiSuccessReport(packet);

    const briefing = await loadAiStudyBriefing({
      publicDemo: false,
      sessionDate,
      env,
      now,
      config: {
        apiKey: "test-key",
        model: "gpt-test",
        timeoutMs: 5000,
        maxRetries: 0,
        maxOutputTokens: 500,
        parseRetries: 0,
      },
      fetchImpl: mockOpenAiSuccess(packet),
    });

    expect(briefing.mode).toBe("historical");
    expect(briefing.provider).toBe("openai");
    expect(briefing.model).toBe("gpt-test");
    expect(briefing.status).toBe("ready");
    expect(briefing.grounding?.citationsValid).toBe(true);
    expect(briefing.grounding?.numbersValid).toBe(true);
    expect(claimText(briefing.report!.marketRegime)).toBe(expectedRegime);
  });
});

describe("generateAiStudyWithFake", () => {
  it("returns provider error mode", async () => {
    const packet = await collectAiStudyInputs({
      publicDemo: true,
    });
    const result = await generateAiStudyWithFake({
      packet,
      mode: "provider_error",
    });
    expect(result.ok).toBe(false);
  });
});

describe("loadSyntheticAiStudyBriefing", () => {
  it("loads bundled fixture report sections", () => {
    const briefing = loadSyntheticAiStudyBriefing({
      generatedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(claimText(briefing.report!.scenarios.base)).toMatch(/Demo status-quo/i);
  });
});
