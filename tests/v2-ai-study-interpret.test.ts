import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import {
  describeMissingAiStudyLlmEnv,
  loadAiStudyLlmConfig,
  openAiResponsesReasoningEffort,
} from "@/ai-study/config";
import {
  buildV2AiStudyFallback,
  buildV2AiStudyPayload,
  deriveSpyGammaSpotPosition,
  deriveV2AiStudyDataQuality,
  generateV2CommandAiStudyInterpretation,
  validateV2AiStudyLlmGrounding,
  verifyV2AiStudyPayloadAlignsWithView,
  type V2AiStudyPayload,
} from "@/ai-study/v2-command-interpret";
import { loadV2HomePage } from "@/desk/load-v2-home";
import { DominantDriver } from "@/contracts";
import {
  buildV2CommandCenterView,
  classifySectorRotationRow,
  summarizeMacroFromDriver,
} from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import { readFileSync } from "node:fs";

const fixtureDriver = DominantDriver.parse(
  JSON.parse(
    readFileSync("fixtures/macro/dominant-driver.rates-led-easing.json", "utf8"),
  ),
);

loadEnvConfig(process.cwd());

function minimalSpyPayload(
  spyGamma: Record<string, unknown>,
  interpretationConfidence: "high" | "moderate" | "limited" = "moderate",
): V2AiStudyPayload {
  return {
    promptVersion: "0.2.0",
    sessionDate: "2026-08-13",
    decision: {
      stance: "hold",
      riskScore: 55,
      riskChange: 6,
      exposure: { min: 68, max: 84 },
      opportunityScore: 45,
    },
    spyGamma,
    breadth: {
      signal: "mixed",
      percentAboveMa20: 63.4,
      percentAboveMa50: 62.9,
      stale: true,
      marketSessionDate: "2026-08-11",
    },
    dataQuality: {
      interpretationConfidence,
      limitations: [],
      missingTopics: [],
    },
  };
}

describe("v2 command ai study", () => {
  it("omits reasoning.effort for gpt-4.1-mini", () => {
    expect(openAiResponsesReasoningEffort("gpt-4.1-mini")).toBeUndefined();
    expect(openAiResponsesReasoningEffort("gpt-5.6-luna")).toEqual({
      effort: "none",
    });
  });

  it("builds a compact payload from command center fields only", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });

    const payload = buildV2AiStudyPayload(view, null);
    expect(payload.sessionDate).toBe(view.sessionDate);
    expect(payload.spyGamma).toBeTruthy();
    expect(payload.qqqGamma).toBeUndefined();
    expect(JSON.stringify(payload.spyGamma).includes("option")).toBe(false);
    expect(payload.dataQuality.interpretationConfidence).toBeDefined();
  });

  it("produces a deterministic fallback with five copilot sections", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    const fallback = buildV2AiStudyFallback(payload);

    expect(fallback.status).toBe("fallback");
    expect(fallback.source).toBe("deterministic");
    expect(fallback.regime.length).toBeGreaterThan(0);
    expect(fallback.baseCase.length).toBeGreaterThan(0);
    expect(fallback.ifThen.length).toBeGreaterThan(0);
    expect(fallback.invalidation.length).toBeGreaterThan(0);
    expect(fallback.tension.length).toBeGreaterThan(0);
    expect(fallback.confidence).toBeDefined();
    expect(Array.isArray(fallback.dataLimitations)).toBe(true);
  });

  it("derives limited confidence when breadth is stale and gamma incomplete", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: fixtureDriver,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
      spyBreadth: {
        status: "available",
        stale: true,
        marketSessionDate: "2026-08-11",
        asOf: "2026-08-12T00:00:00.000Z",
        advance: 276,
        decline: 224,
        unchanged: 3,
        percentAboveMA20: 63.4,
        percentAboveMA50: 62.9,
        new20DayClosingHigh: 16.1,
        new20DayClosingLow: 6.6,
        missingReason: "dated",
        sourceArtifact: "breadth/test",
        advancingPct: 54.9,
        breadthSignal: "mixed",
        breadthSignalStatus: "available",
        breadthContextLine: "mixed",
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    expect(payload.dataQuality.interpretationConfidence).toBe("limited");
    expect(payload.dataQuality.limitations.some((line) => line.includes("Breadth"))).toBe(
      true,
    );
    expect(deriveV2AiStudyDataQuality(view, payload).limitations.length).toBeGreaterThan(
      0,
    );
  });

  it("rejects LLM output with invented price levels", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    const result = validateV2AiStudyLlmGrounding(
      {
        regime: "SPY must reclaim 999 to stabilize.",
        base_case: "Hold.",
        if_then: "No trigger.",
        invalidation: "None.",
        tension: "None.",
      },
      payload,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects strong directional language when confidence is limited", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    const limitedPayload = {
      ...payload,
      dataQuality: {
        ...payload.dataQuality,
        interpretationConfidence: "limited" as const,
      },
    };
    const result = validateV2AiStudyLlmGrounding(
      {
        regime: "Market will rally sharply from here.",
        base_case: "Bullish breakout imminent.",
        if_then: "If SPY holds → more upside.",
        invalidation: "None.",
        tension: "None.",
      },
      limitedPayload,
    );
    expect(result.ok).toBe(false);
  });

  it("includes macro interpretation and evidence in the payload", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const afterClose = easternWallToUtc("2026-07-28", 17, 0, 0);
    const macro = summarizeMacroFromDriver(fixtureDriver, { now: afterClose });
    const view = await buildV2CommandCenterView({
      driver: fixtureDriver,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
      now: afterClose,
    });

    expect(view.macroSummary).toEqual(macro);
    const payload = buildV2AiStudyPayload(view, null);
    expect(payload.macro?.label).toBe(fixtureDriver.label);
    expect(payload.macro?.interpretation).toContain(fixtureDriver.interpretation.text);
    expect(payload.macro?.evidence?.length).toBeGreaterThan(0);
  });

  it("reports missing OPENAI_API_KEY instead of a generic LLM failure", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    const env = {
      ...process.env,
      OPENAI_API_KEY: "",
      AI_STUDY_LLM_MODEL: "",
    };
    expect(describeMissingAiStudyLlmEnv(env)).toEqual(["OPENAI_API_KEY"]);

    const result = await generateV2CommandAiStudyInterpretation({
      payload,
      config: loadAiStudyLlmConfig(env),
      env,
    });

    expect(result.status).toBe("fallback");
    expect(result.missingReason).toContain("OPENAI_API_KEY");
    expect(result.missingReason).not.toContain("LLM unavailable");
  });

  it("mirrors command center view fields in the LLM payload", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = await buildV2CommandCenterView({
      driver: fixtureDriver,
      spyGamma: spy,
      qqqGamma: {
        status: "empty",
        snapshot: null,
        withheldSnapshot: null,
        sourceLabel: "QQQ unavailable",
        isFixture: false,
        error: { code: "empty", message: "unavailable" },
      },
    });
    const payload = buildV2AiStudyPayload(view, null);
    const alignment = verifyV2AiStudyPayloadAlignsWithView(view, payload, null);
    expect(alignment.ok).toBe(true);
    if (!alignment.ok) {
      throw new Error(alignment.mismatches.join("; "));
    }
    expect(payload.spyGamma?.spot).toBe(view.gamma[0].spot);
    expect(payload.spyGamma?.callWall).toBe(view.gamma[0].callWall);
    expect(payload.spyGamma?.putWall).toBe(view.gamma[0].putWall);
    expect(payload.spyGamma?.gammaFlip).toBe(view.gamma[0].gammaFlip);
  });

  it.skipIf(
    !process.env.OPENAI_API_KEY ||
      process.env.GAMMADESK_RUN_LIVE_OPENAI_TESTS !== "1",
  )(
    "production path: loadV2HomePage aligns payload with rendered command center",
    async () => {
      const { view } = await loadV2HomePage({ demo: false });
      expect(view.gamma[0].isFixture).toBe(false);

      const payload = buildV2AiStudyPayload(view, null);
      const alignment = verifyV2AiStudyPayloadAlignsWithView(view, payload, null);
      if (!alignment.ok) {
        throw new Error(alignment.mismatches.join("; "));
      }
      expect(alignment.ok).toBe(true);

      expect(view.aiStudy.status).toBe("ready");
      expect(view.aiStudy.source).toBe("openai");

      const spy = view.gamma[0];
      console.log(
        JSON.stringify({
          model: loadAiStudyLlmConfig(process.env).model,
          sessionDate: view.sessionDate,
          riskScore: view.riskScore,
          stance: view.stance,
          spySpot: spy.spot,
          spyCallWall: spy.callWall,
          spyPutWall: spy.putWall,
          spyGammaFlip: spy.gammaFlip,
          payloadSpySpot: payload.spyGamma?.spot,
          payloadSpyCallWall: payload.spyGamma?.callWall,
          payloadSpyPutWall: payload.spyGamma?.putWall,
          payloadSpyGammaFlip: payload.spyGamma?.gammaFlip,
          aiStudyStatus: view.aiStudy.status,
          confidence: view.aiStudy.confidence,
          dataLimitations: view.aiStudy.dataLimitations,
          regime: view.aiStudy.regime,
          base_case: view.aiStudy.baseCase,
          if_then: view.aiStudy.ifThen,
          invalidation: view.aiStudy.invalidation,
          tension: view.aiStudy.tension,
        }),
      );
    },
    120_000,
  );

  it("classifies sectors with the desk rotation rule", () => {
    expect(classifySectorRotationRow(0.5, 1.0, true, true)).toBe("leading");
    expect(classifySectorRotationRow(0.3, -0.5, true, false)).toBe("improving");
  });

  describe("gamma structure semantics for if_then and invalidation", () => {
    const baseSpy = {
      symbol: "SPY",
      regime: "positive",
      dealerFlow: "Stabilizing / mean-reverting dealer flow",
      gammaFlip: 771.9,
      callWall: 774,
      putWall: 773,
    };

    it("spot above flip: if_then crosses below flip; invalidation not reclaim flip", () => {
      const payload = minimalSpyPayload({ ...baseSpy, spot: 772.66 });
      const position = deriveSpyGammaSpotPosition(payload.spyGamma);
      expect(position.aboveFlip).toBe(true);
      expect(position.belowPutWall).toBe(true);

      const fallback = buildV2AiStudyFallback(payload);
      expect(fallback.ifThen).toMatch(/crosses from above gamma flip 771\.9 to below/);
      expect(fallback.ifThen).toMatch(/reclaims and holds above put wall 773/);
      expect(fallback.ifThen).not.toMatch(/mean-reversion corridor/);
      expect(fallback.ifThen).not.toMatch(/loses gamma flip/);
      expect(fallback.invalidation).toMatch(/crosses from above gamma flip 771\.9 to below/);
      expect(fallback.invalidation).not.toMatch(/below put wall 773/);
      expect(fallback.invalidation).not.toMatch(/reclaims and holds gamma flip/);
    });

    it("spot below flip: if_then reclaims flip; invalidation crosses below", () => {
      const payload = minimalSpyPayload({ ...baseSpy, spot: 770.5 });
      const position = deriveSpyGammaSpotPosition(payload.spyGamma);
      expect(position.belowFlip).toBe(true);

      const fallback = buildV2AiStudyFallback(payload);
      expect(fallback.ifThen).toMatch(/reclaims and holds above gamma flip 771\.9/);
      expect(fallback.ifThen).not.toMatch(/crosses from above gamma flip/);
      expect(fallback.invalidation).not.toMatch(/reclaims and holds gamma flip/);
    });

    it("spot above call wall: chase pressure path, not mean reversion", () => {
      const payload = minimalSpyPayload({ ...baseSpy, spot: 775 });
      const position = deriveSpyGammaSpotPosition(payload.spyGamma);
      expect(position.aboveCallWall).toBe(true);

      const fallback = buildV2AiStudyFallback(payload);
      expect(fallback.ifThen).toMatch(/fails to hold above call wall 774/);
      expect(fallback.ifThen).not.toMatch(/mean-reversion/);
      expect(fallback.invalidation).not.toMatch(/breaks and holds above call wall/);
    });

    it("spot below put wall: reclaim path; invalidation not already below put wall", () => {
      const payload = minimalSpyPayload({ ...baseSpy, spot: 772 });
      const position = deriveSpyGammaSpotPosition(payload.spyGamma);
      expect(position.belowPutWall).toBe(true);
      expect(position.aboveFlip).toBe(true);

      const fallback = buildV2AiStudyFallback(payload);
      expect(fallback.ifThen).toMatch(/reclaims and holds above put wall 773/);
      expect(fallback.ifThen).not.toMatch(/breaks and holds below put wall/);
      expect(fallback.invalidation).not.toMatch(/below put wall 773/);
      expect(fallback.invalidation).not.toMatch(/sustained below put wall/);
    });

    it("spot near flip: treats as above-side transition path", () => {
      const payload = minimalSpyPayload({ ...baseSpy, spot: 772.1 });
      const position = deriveSpyGammaSpotPosition(payload.spyGamma);
      expect(position.nearFlip).toBe(true);

      const fallback = buildV2AiStudyFallback(payload);
      expect(fallback.ifThen).toMatch(/crosses from above gamma flip 771\.9 to below/);
      expect(fallback.baseCase).toMatch(/near gamma flip 771\.9/);
    });
  });
});
