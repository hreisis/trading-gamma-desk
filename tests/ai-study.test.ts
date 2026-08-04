import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/ingest/http";
import {
  collectAiStudyInputs,
  generateAiStudyWithFake,
  loadAiStudyBriefing,
  loadSyntheticAiStudyBriefing,
} from "@/ai-study";
import type { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockOpenAiSuccess(): FetchLike {
  const report: AiStudyNarratorRawOutput = {
    marketRegime: "Rates-led easing with mixed cross-asset confirmation.",
    mainDrivers: ["Macro driver label from packet.", "Catalyst headlines only."],
    keyLevelsStructure: ["SPY spot and bounded walls from supplied gamma facts."],
    upcomingRisks: ["Listed catalysts only."],
    scenarios: {
      bull: "Conditional upside if provided macro context persists.",
      base: "Base case using supplied inputs only.",
      bear: "Conditional downside if catalyst risk in packet materializes.",
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
      GAMMADESK_PUBLIC_DEMO: "1",
    } as unknown as NodeJS.ProcessEnv);

    expect(
      packet.inputs.find((i) => i.id === "market_temperature")?.status,
    ).toBe("unavailable");
    expect(packet.inputs.find((i) => i.id === "macro")?.status).toBe("fixture");
    expect(packet.inputs.find((i) => i.id === "historical_study")?.status).toBe(
      "fixture",
    );
    expect(JSON.stringify(packet.facts)).not.toContain("invented");
  });
});

describe("loadAiStudyBriefing", () => {
  it("returns synthetic demo briefing without OpenAI", async () => {
    const briefing = await loadAiStudyBriefing({
      publicDemo: true,
    });

    expect(briefing.status).toBe("synthetic_demo");
    expect(briefing.provider).toBe("synthetic_demo");
    expect(briefing.message).toBe(PUBLIC_DEMO_BANNER);
    expect(briefing.report?.scenarios.bull.length).toBeGreaterThan(0);
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
    });

    expect(briefing.status).toBe("ready");
    expect(briefing.provider).toBe("openai");
    expect(briefing.report?.mainDrivers.length).toBeGreaterThan(0);
  });

  it("surfaces OpenAI HTTP errors", async () => {
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

    expect(briefing.status).toBe("error");
    expect(briefing.message).toMatch(/OpenAI HTTP 401/i);
  });

  it("accepts mocked OpenAI success payload", async () => {
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
      fetchImpl: mockOpenAiSuccess(),
    });

    expect(briefing.status).toBe("ready");
    expect(briefing.report?.marketRegime).toContain("Rates-led easing");
  });
});

describe("generateAiStudyWithFake", () => {
  it("returns provider error mode", async () => {
    const packet = await collectAiStudyInputs({
      GAMMADESK_PUBLIC_DEMO: "1",
    } as unknown as NodeJS.ProcessEnv);
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
    expect(briefing.report?.scenarios.base).toMatch(/Demo status-quo/i);
  });
});
