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
  generateV2CommandAiStudyInterpretation,
  verifyV2AiStudyPayloadAlignsWithView,
} from "@/ai-study/v2-command-interpret";
import { loadV2HomePage } from "@/desk/load-v2-home";
import { DominantDriver } from "@/contracts";
import {
  buildV2CommandCenterView,
  classifySectorRotationRow,
  summarizeMacroFromDriver,
} from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";
import { readFileSync } from "node:fs";

const fixtureDriver = DominantDriver.parse(
  JSON.parse(
    readFileSync("fixtures/macro/dominant-driver.rates-led-easing.json", "utf8"),
  ),
);

loadEnvConfig(process.cwd());

describe("v2 command ai study", () => {
  it("omits reasoning.effort for gpt-4.1-mini", () => {
    expect(openAiResponsesReasoningEffort("gpt-4.1-mini")).toBeUndefined();
    expect(openAiResponsesReasoningEffort("gpt-5.6-luna")).toEqual({
      effort: "none",
    });
  });

  it("builds a compact payload from command center fields only", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
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
    expect(JSON.stringify(payload).includes("option")).toBe(false);
  });

  it("produces a deterministic fallback with five structured fields", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
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
    expect(fallback.marketSetup.length).toBeGreaterThan(0);
    expect(fallback.keyUpsideTrigger.length).toBeGreaterThan(0);
    expect(fallback.keyDownsideTrigger.length).toBeGreaterThan(0);
    expect(fallback.mainSupportingSignal.length).toBeGreaterThan(0);
    expect(fallback.mainConflictingSignal.length).toBeGreaterThan(0);
  });

  it("includes macro interpretation and evidence in the payload", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const macro = summarizeMacroFromDriver(fixtureDriver);
    const view = buildV2CommandCenterView({
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

    expect(view.macroSummary).toEqual(macro);
    const payload = buildV2AiStudyPayload(view, null);
    expect(payload.macro?.label).toBe(fixtureDriver.label);
    expect(payload.macro?.interpretation).toBe(fixtureDriver.interpretation.text);
    expect(payload.macro?.evidence?.length).toBeGreaterThan(0);
  });

  it("reports missing OPENAI_API_KEY instead of a generic LLM failure", async () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
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

  it("mirrors command center view fields in the LLM payload", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
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
          market_setup: view.aiStudy.marketSetup,
          key_upside_trigger: view.aiStudy.keyUpsideTrigger,
          key_downside_trigger: view.aiStudy.keyDownsideTrigger,
          main_supporting_signal: view.aiStudy.mainSupportingSignal,
          main_conflicting_signal: view.aiStudy.mainConflictingSignal,
        }),
      );
    },
    120_000,
  );

  it("classifies sectors with the desk rotation rule", () => {
    expect(classifySectorRotationRow(0.5, 1.0, true, true)).toBe("leading");
    expect(classifySectorRotationRow(0.3, -0.5, true, false)).toBe("improving");
  });
});
