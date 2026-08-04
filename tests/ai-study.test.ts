import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/ingest/http";
import {
  collectAiStudyInputs,
  generateAiStudyWithFake,
  loadAiStudyBriefing,
  loadSyntheticAiStudyBriefing,
} from "@/ai-study";
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

function mockOpenAiSuccess(): FetchLike {
  const report: AiStudyNarratorRawOutput = {
    marketRegime: claim("Rates-led easing with mixed cross-asset confirmation.", [
      "macro.label",
    ]),
    mainDrivers: [
      claim("Macro driver label from packet.", ["macro.interpretation"]),
      claim("Cross-asset context from supplied macro facts only.", ["macro.label"]),
    ],
    keyLevelsStructure: [
      claim("Structure levels omitted when bounded gamma is unavailable for session.", [
        "macro.label",
      ]),
    ],
    upcomingRisks: [claim("Listed catalysts only when present in packet.", ["macro.label"])],
    scenarios: {
      bull: claim("Conditional upside if provided macro context persists.", [
        "macro.label",
      ]),
      base: claim("Base case using supplied inputs only.", ["macro.label"]),
      bear: claim(
        "Conditional downside if macro risk direction in packet intensifies.",
        ["macro.riskDirection"],
      ),
    },
  };
  return () =>
    Promise.resolve(
      jsonResponse(200, {
        output_text: JSON.stringify(report),
      }),
    );
}

describe("collectAiStudyInputs", () => {
  it("labels market temperature unavailable and public demo fixtures", async () => {
    const packet = await collectAiStudyInputs({
      publicDemo: true,
    });

    expect(
      packet.inputs.find((i) => i.id === "market_temperature")?.status,
    ).toBe("unavailable");
    expect(packet.inputs.find((i) => i.id === "macro")?.status).toBe("fixture");
    expect(packet.inputs.find((i) => i.id === "historical_study")?.status).toBe(
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

  it("returns unavailable when OPENAI_API_KEY is missing", async () => {
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

    expect(briefing.status).toBe("unavailable");
    expect(briefing.message).toMatch(/OPENAI_API_KEY missing/i);
    expect(briefing.report).toBeNull();
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
    const briefing = await loadAiStudyBriefing({
      publicDemo: false,
      sessionDate: "2026-07-29",
      env: { OPENAI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      config: {
        apiKey: "test-key",
        model: "gpt-test",
        timeoutMs: 5000,
        maxRetries: 0,
        maxOutputTokens: 500,
        parseRetries: 0,
      },
      fetchImpl: mockOpenAiSuccess(),
    });

    expect(briefing.mode).toBe("historical");
    expect(["ready", "error"]).toContain(briefing.status);
    expect(claimText(briefing.report!.marketRegime)).toContain("Rates-led easing");
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
