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
  V2_COMMAND_AI_STUDY_SYSTEM_PROMPT,
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
    promptVersion: "0.4.3",
    sessionDate: "2026-08-13",
    decision: {
      stance: "hold",
      riskScore: 55,
      riskChange: 6,
      exposure: { min: 68, max: 84 },
      opportunityScore: 45,
      riskChangeReason: null,
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
    expect(payload.qualitativeContext).toBeDefined();
    expect(payload.promptVersion).toBe("0.4.3");
  });

  it("requires relational desk-note reasoning without changing output fields", () => {
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Select ONE dominant conflict or confirmation",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Never treat every weakening print as full confirmation",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Elevated/dislocation opportunity may come from washout",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "do not invent intraday ordering",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "confirmation and invalidation conditions",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "NOT a credit-spread series",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Never invent numeric thresholds",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "use its sign for the equity leg",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "The recommended action is ONLY historicalPolicy.positioning",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "<45 = limited tactical opportunity",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Final draft audit before returning JSON",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "For TRIM / DEFENSIVE, REDUCE, and REDUCE CORE",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "the rally/improvement is NOT credit-confirmed",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Never imply a risk-on or easing macro shift caused Risk to rise",
    );
    expect(V2_COMMAND_AI_STUDY_SYSTEM_PROMPT).toContain(
      "Recovery is never a TRIM confirmation",
    );
  });

  it("produces a deterministic fallback with ten copilot sections", async () => {
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
    expect(fallback.baseCase).not.toMatch(/Model stance/i);
    expect(fallback.ifThen.length).toBeGreaterThan(0);
    expect(fallback.invalidation.length).toBeGreaterThan(0);
    expect(fallback.tension.length).toBeGreaterThan(0);
    expect(fallback.hiddenRisk.length).toBeGreaterThan(0);
    expect(fallback.reactionQuality.length).toBeGreaterThan(0);
    expect(fallback.crossAssetConflict.length).toBeGreaterThan(0);
    expect(fallback.whatChanged.length).toBeGreaterThan(0);
    expect(fallback.whatMattersNext.length).toBeGreaterThan(0);
    expect(fallback.confidence).toBeDefined();
    expect(Array.isArray(fallback.dataLimitations)).toBe(true);

    const withPolicy = buildV2AiStudyFallback(
      buildV2AiStudyPayload(view, null, {
        positioning: "TRIM / DEFENSIVE",
        riskTrend: "deteriorating",
      }),
    );
    expect(withPolicy.baseCase).toContain("TRIM / DEFENSIVE");
    expect(withPolicy.baseCase).not.toMatch(/Model stance/i);
    expect(withPolicy.regime).not.toMatch(/\bstance\b/i);
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
        hidden_risk: "None.",
        reaction_quality: "None.",
        cross_asset_conflict: "None.",
        what_changed: "None.",
        what_matters_next: "None.",
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
        hidden_risk: "None.",
        reaction_quality: "None.",
        cross_asset_conflict: "None.",
        what_changed: "None.",
        what_matters_next: "None.",
      },
      limitedPayload,
    );
    expect(result.ok).toBe(false);
  });

  it("enforces credit field isolation and HYG/LQD terminology", () => {
    const payload: V2AiStudyPayload = {
      ...minimalSpyPayload({
        symbol: "SPY",
        spot: 770,
        gammaFlip: 772,
        putWall: 768,
        callWall: 775,
      }),
      creditHygLqd: {
        ratio: 0.75,
        change1dPct: -0.2,
        trend5dPct: -0.4,
        signal: "weakening",
        spyChange1dPct: -0.3,
        sessionDate: "2026-08-13",
      },
    };
    const base = {
      regime: "Negative gamma with HYG/LQD weakening.",
      base_case: "Hold.",
      if_then: "If breadth improves from Mixed to Strong, participation broadens.",
      invalidation: "SPY reclaims gamma flip 772.",
      tension: "Negative gamma vs mixed breadth.",
      hidden_risk: "HYG/LQD weakening signals deteriorating credit risk appetite.",
      reaction_quality: "Mixed breadth does not confirm the structure.",
      cross_asset_conflict: "Equity stress is confirmed by HYG/LQD weakening.",
      what_changed: "HYG/LQD weakened 0.4% over 5D.",
      what_matters_next: "SPY reclaiming gamma flip 772 would confirm stabilization.",
    };

    expect(validateV2AiStudyLlmGrounding(base, payload)).toEqual({
      ok: false,
      reason:
        "HYG/LQD credit evidence is restricted to hidden_risk, cross_asset_conflict, and what_changed",
    });
    expect(
      validateV2AiStudyLlmGrounding(
        {
          ...base,
          regime: "Negative gamma with mixed breadth.",
          hidden_risk: "Credit spreads widened.",
        },
        payload,
      ),
    ).toEqual({
      ok: false,
      reason: "HYG/LQD is a ratio proxy, not a credit-spread series",
    });
  });

  it("rejects future conditions already true at current spot", () => {
    const payload = minimalSpyPayload({
      symbol: "SPY",
      spot: 767,
      gammaFlip: 772,
      putWall: 768,
      callWall: 775,
    });
    const result = validateV2AiStudyLlmGrounding(
      {
        regime: "Negative gamma with mixed breadth.",
        base_case: "Hold.",
        if_then: "If breadth improves from Mixed to Strong, participation broadens.",
        invalidation: "If SPY falls below put wall 768, downside risk rises.",
        tension: "Negative gamma vs mixed breadth.",
        hidden_risk: "Amplifying structure may deepen moves.",
        reaction_quality: "Mixed breadth does not confirm the structure.",
        cross_asset_conflict: "No cross-asset conflict flagged.",
        what_changed: "No prior-session change evidence.",
        what_matters_next: "SPY reclaiming gamma flip 772 would confirm stabilization.",
      },
      payload,
    );
    expect(result).toEqual({
      ok: false,
      reason: "put-wall condition is already true at current spot",
    });
  });

  it("rejects Risk V1 stance as the action when Positioning V2 is present", () => {
    const payload: V2AiStudyPayload = {
      ...minimalSpyPayload({
        symbol: "SPY",
        spot: 770,
        gammaFlip: 772,
        putWall: 768,
        callWall: 775,
      }),
      historicalPolicy: { positioning: "HOLD / WAIT" },
    };
    const result = validateV2AiStudyLlmGrounding(
      {
        regime: "Positive gamma with mixed breadth.",
        base_case: "The buy stance is supported by stabilizing dealer flow.",
        if_then: "If breadth improves from Mixed to Strong, participation broadens.",
        invalidation: "If breadth deteriorates from Mixed to Weak, participation thins.",
        tension: "Stabilizing flow vs mixed breadth.",
        hidden_risk: "No off-model hidden risk is flagged.",
        reaction_quality: "Mixed breadth does not confirm the structure.",
        cross_asset_conflict: "No cross-asset conflict is flagged.",
        what_changed: "Risk ticked higher vs the prior session.",
        what_matters_next: "Breadth Mixed to Strong would confirm HOLD / WAIT.",
      },
      payload,
    );
    expect(result).toEqual({
      ok: false,
      reason: "Risk V1 stance must not be used as the recommended action",
    });
  });

  it("rejects high Opportunity wording below 65 and full credit confirmation on mild HYG/LQD", () => {
    const payload: V2AiStudyPayload = {
      ...minimalSpyPayload({
        symbol: "SPY",
        spot: 770,
        gammaFlip: 772,
        putWall: 768,
        callWall: 775,
      }),
      decision: {
        stance: "hold",
        riskScore: 55,
        riskChange: 5,
        exposure: { min: 68, max: 84 },
        opportunityScore: 67,
        riskChangeReason: null,
      },
      historicalPolicy: { positioning: "HOLD" },
      creditHygLqd: {
        ratio: 0.7506,
        change1dPct: -0.13,
        trend5dPct: -0.35,
        signal: "weakening",
        spyChange1dPct: -0.28,
        sessionDate: "2026-08-13",
      },
    };
    const result = validateV2AiStudyLlmGrounding(
      {
        regime: "Negative gamma with mixed breadth.",
        base_case: "HOLD remains appropriate; elevated dislocation opportunity is not low Risk.",
        if_then: "If breadth improves from Mixed to Strong, participation broadens.",
        invalidation: "SPY reclaims gamma flip 772.",
        tension: "Negative gamma vs mixed breadth.",
        hidden_risk: "HYG/LQD weakening is a hidden credit-appetite risk.",
        reaction_quality: "Mixed breadth does not confirm the structure.",
        cross_asset_conflict:
          "Equity stress is confirmed by HYG/LQD weakening, a full credit confirmation.",
        what_changed: "HYG/LQD 1D -0.13% and 5D -0.35%.",
        what_matters_next: "SPY reclaiming gamma flip 772 would confirm stabilization.",
      },
      payload,
    );
    expect(result).toEqual({
      ok: false,
      reason: "HYG/LQD move is only mild/early confirmation, not full confirmation",
    });

    const limitedOpp = {
      ...payload,
      decision: { ...payload.decision!, opportunityScore: 39 },
      historicalPolicy: { positioning: "HOLD / WAIT" },
      creditHygLqd: undefined,
    };
    expect(
      validateV2AiStudyLlmGrounding(
        {
          regime: "Positive gamma with mixed breadth.",
          base_case:
            "HOLD / WAIT is the action; high Opportunity does not justify adding.",
          if_then: "If breadth improves from Mixed to Strong, participation broadens.",
          invalidation: "If breadth deteriorates from Mixed to Weak, participation thins.",
          tension: "Stabilizing flow vs mixed breadth.",
          hidden_risk: "No off-model hidden risk is flagged.",
          reaction_quality: "Mixed breadth does not confirm the structure.",
          cross_asset_conflict: "No cross-asset conflict is flagged.",
          what_changed: "Risk ticked higher vs the prior session.",
          what_matters_next: "Breadth Mixed to Strong would confirm HOLD / WAIT.",
        },
        limitedOpp,
      ),
    ).toEqual({
      ok: false,
      reason: "Opportunity is not in the elevated band",
    });
  });

  it("rejects credit-weakening as support for SELECTIVE ADD when equities rose", () => {
    const payload: V2AiStudyPayload = {
      ...minimalSpyPayload({
        symbol: "SPY",
        spot: 773,
        gammaFlip: 772,
        putWall: 768,
        callWall: 775,
      }),
      decision: {
        stance: "buy",
        riskScore: 35,
        riskChange: 0,
        exposure: { min: 68, max: 84 },
        opportunityScore: 47,
        riskChangeReason: "Breadth weak → mixed",
      },
      historicalPolicy: { positioning: "SELECTIVE ADD" },
      creditHygLqd: {
        ratio: 0.7478,
        change1dPct: -0.49,
        trend5dPct: -0.32,
        signal: "weakening",
        spyChange1dPct: 0.22,
        sessionDate: "2026-08-13",
      },
    };
    expect(
      validateV2AiStudyLlmGrounding(
        {
          regime: "Positive gamma with mixed breadth.",
          base_case: "SELECTIVE ADD is supported by positive gamma.",
          if_then: "If breadth improves from Mixed to Strong, participation broadens.",
          invalidation: "If breadth deteriorates from Mixed to Weak, participation thins.",
          tension: "Mixed breadth vs stabilizing flow.",
          hidden_risk: "HYG/LQD weakening is a hidden credit-appetite risk.",
          reaction_quality: "Stabilizing flow aligns with mixed breadth.",
          cross_asset_conflict:
            "Mild early credit confirmation supports SELECTIVE ADD positioning.",
          what_changed: "Breadth improved Weak to Mixed.",
          what_matters_next: "Breadth Mixed to Strong would confirm SELECTIVE ADD.",
        },
        payload,
      ),
    ).toEqual({
      ok: false,
      reason:
        "equity up with HYG/LQD weakening means the rally is not credit-confirmed",
    });
  });

  it("rejects Risk-rise attribution to risk-on macro and TRIM recovery-as-confirmation", () => {
    const payload: V2AiStudyPayload = {
      ...minimalSpyPayload({
        symbol: "SPY",
        spot: 770,
        gammaFlip: 772,
        putWall: 768,
        callWall: 775,
      }),
      historicalPolicy: { positioning: "TRIM / DEFENSIVE" },
    };
    expect(
      validateV2AiStudyLlmGrounding(
        {
          regime: "Negative gamma with weak breadth.",
          base_case: "TRIM / DEFENSIVE remains the action.",
          if_then:
            "If breadth improves from Weak to Strong, the TRIM / DEFENSIVE confirmation is reinforced.",
          invalidation: "If breadth stays Weak, the thesis is unchanged.",
          tension: "Negative gamma vs weak breadth.",
          hidden_risk: "No off-model hidden risk is flagged.",
          reaction_quality: "Amplifying flow aligns with weak breadth.",
          cross_asset_conflict: "No cross-asset conflict is flagged.",
          what_changed: "Risk rose as macro shifted mixed to risk_on.",
          what_matters_next: "Flip reclaim would confirm TRIM / DEFENSIVE.",
        },
        payload,
      ),
    ).toEqual({
      ok: false,
      reason: "do not attribute a Risk rise to a risk-on or easing factor",
    });

    expect(
      validateV2AiStudyLlmGrounding(
        {
          regime: "Negative gamma with weak breadth.",
          base_case: "TRIM / DEFENSIVE remains the action.",
          if_then:
            "If breadth stays Weak with amplifying flow, TRIM / DEFENSIVE is confirmed.",
          invalidation: "If breadth improves from Weak to Mixed, the trim weakens.",
          tension: "Negative gamma vs weak breadth.",
          hidden_risk: "No off-model hidden risk is flagged.",
          reaction_quality: "Amplifying flow aligns with weak breadth.",
          cross_asset_conflict: "No cross-asset conflict is flagged.",
          what_changed: "Breadth Mixed to Weak increased Risk.",
          what_matters_next:
            "If breadth recovers to Strong, that would confirm TRIM / DEFENSIVE.",
        },
        payload,
      ),
    ).toEqual({
      ok: false,
      reason:
        "TRIM / DEFENSIVE confirmation cannot be breadth improvement, flip reclaim, or stabilizing flow",
    });
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

      expect(view.webResearch?.content.sections).toHaveLength(3);
      expect(view.webResearch?.content.summary.en).toBeTruthy();

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
          hidden_risk: view.aiStudy.hiddenRisk,
          reaction_quality: view.aiStudy.reactionQuality,
          cross_asset_conflict: view.aiStudy.crossAssetConflict,
          what_changed: view.aiStudy.whatChanged,
          what_matters_next: view.aiStudy.whatMattersNext,
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
