import { describe, expect, it } from "vitest";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import {
  buildV2DailyReviewFallback,
  buildV2DailyReviewPayload,
  classifyDailyReviewErrorSource,
  deriveDailyReviewThesisCritique,
  validateV2DailyReviewLlmGrounding,
  type V2DailyReviewPayload,
} from "@/ai-study/v2-daily-review-interpret";
import type {
  CommandCenterV1DailySnapshot,
  V2DailyReview,
  V2DailyReviewInterpretationContext,
  V2DailyReviewSessionEval,
} from "@/desk/command-center-v1";
import { buildV2CommandCenterView } from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk";

function baseSnapshot(
  overrides: Partial<CommandCenterV1DailySnapshot["spy"]> = {},
): CommandCenterV1DailySnapshot {
  return {
    schemaVersion: "0.1.0",
    sessionDate: "2026-08-12",
    generatedAt: "2026-08-12T14:00:00.000Z",
    stance: "hold",
    riskScore: 47,
    exposure: { min: 60, max: 75 },
    spy: {
      spot: 770,
      callWall: 775,
      putWall: 768,
      gammaFlip: 772,
      dealerFlow: "Stabilizing / mean-reverting dealer flow",
      netGex: 100,
      netGexLabel: "+100M",
      restOfDayRange: {
        status: "available",
        lower: 765,
        upper: 778,
        confidencePct: 90,
      },
      ...overrides,
    },
    qqq: {
      spot: 400,
      callWall: 405,
      putWall: 395,
      gammaFlip: 398,
      dealerFlow: null,
      netGex: null,
      netGexLabel: null,
      restOfDayRange: {
        status: "unavailable",
        lower: null,
        upper: null,
        confidencePct: null,
      },
    },
    breadth: {
      signal: "mixed",
      signalStatus: "available",
      advancingPct: 55,
      contextLine: "mixed",
    },
    ctaProxy: { signal: "buying", contextLine: "trend up" },
    volMispricing: { signal: "vol_underpriced", spreadVolPts: -2 },
    sectorRotation: {
      sessionDate: "2026-08-12",
      stale: false,
      leadingImproving: [{ symbol: "XLE", label: "XLE · Energy", rs5d: 3.2 }],
      weakening: [],
    },
  };
}

function makeContext(
  snapshot: CommandCenterV1DailySnapshot,
  spyBar: { open: number; high: number; low: number; close: number },
  spyEval: Partial<V2DailyReviewSessionEval> = {},
): V2DailyReviewInterpretationContext {
  const baseEval: V2DailyReviewSessionEval = {
    summary: `SPY closed ${spyBar.close}`,
    worked: [],
    failed: [],
    watch: [],
    callWallTouched: null,
    putWallTouched: null,
    flipTouched: null,
    rodInside: null,
    direction: "up",
    ...spyEval,
  };
  return {
    morningSnapshot: snapshot,
    spyBar: {
      sessionDate: snapshot.sessionDate,
      open: spyBar.open,
      high: spyBar.high,
      low: spyBar.low,
      close: spyBar.close,
      volume: 1_000_000,
    },
    qqqBar: null,
    spyEval: baseEval,
    qqqEval: {
      summary: "QQQ unavailable",
      worked: [],
      failed: [],
      watch: [],
      callWallTouched: null,
      putWallTouched: null,
      flipTouched: null,
      rodInside: null,
      direction: null,
    },
  };
}

function sampleReview(): V2DailyReview {
  return {
    status: "ready",
    source: "deterministic",
    confidence: "moderate",
    dataLimitations: [],
    sessionDate: "2026-08-12",
    morningStance: "Hold · risk 47 · exposure 60–75%",
    actualOutcome: "SPY closed 771",
    whatWorked: [],
    whatFailed: [],
    errorSource: "none",
    errorExplanation: "",
    tomorrowWatch: [],
    missingReason: null,
  };
}

describe("v2 daily review thesis critique", () => {
  it("range-bound: both walls touched, close inside ROD — not a failure", () => {
    const snapshot = baseSnapshot();
    const context = makeContext(snapshot, {
      open: 769,
      high: 776,
      low: 767,
      close: 771,
    }, {
      callWallTouched: true,
      putWallTouched: true,
      flipTouched: true,
      rodInside: true,
      direction: "up",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(critique.failed.some((line) => /touched intraday/i.test(line))).toBe(
      false,
    );
    expect(critique.worked.some((line) => /ROD 90%/i.test(line))).toBe(true);
    expect(critique.worked.some((line) => /probed call wall/i.test(line))).toBe(
      true,
    );
    expect(critique.worked.some((line) => /probed put wall/i.test(line))).toBe(
      true,
    );
  });

  it("stabilizing: close at/above call wall contradicts wall-hold thesis", () => {
    const snapshot = baseSnapshot({
      spot: 770,
      callWall: 775,
      putWall: 768,
      gammaFlip: 778,
    });
    const context = makeContext(snapshot, {
      open: 774,
      high: 776,
      low: 773,
      close: 775,
    }, {
      callWallTouched: true,
      rodInside: true,
      direction: "up",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(
      critique.failed.some((line) =>
        /contradicts stabilizing mean-reversion morning thesis/i.test(line),
      ),
    ).toBe(true);
    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "high",
      limitations: [],
      missingTopics: [],
    });
    expect(error.source).toBe("model");
  });

  it("stabilizing: close at/below put wall contradicts wall-hold thesis", () => {
    const snapshot = baseSnapshot();
    const context = makeContext(snapshot, {
      open: 769,
      high: 770,
      low: 767,
      close: 768,
    }, {
      putWallTouched: true,
      rodInside: false,
      direction: "down",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(
      critique.failed.some((line) =>
        /contradicts stabilizing mean-reversion morning thesis/i.test(line),
      ),
    ).toBe(true);
  });

  it("flip touched with close still above — watch only, not regime failure", () => {
    const snapshot = baseSnapshot({ spot: 773, gammaFlip: 772 });
    const context = makeContext(snapshot, {
      open: 771,
      high: 774,
      low: 770,
      close: 773,
    }, {
      flipTouched: true,
      rodInside: true,
      direction: "up",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(critique.failed.some((line) => /closed below gamma flip/i.test(line))).toBe(
      false,
    );
    expect(
      critique.watch.some((line) => /intraday cross sequence not available/i.test(line)),
    ).toBe(true);
  });

  it("incomplete gamma limitation but thesis works → error none, not data", () => {
    const snapshot = baseSnapshot();
    const context = makeContext(snapshot, {
      open: 769,
      high: 772,
      low: 768,
      close: 771,
    }, { rodInside: true, direction: "up" });
    const critique = deriveDailyReviewThesisCritique(context);
    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "moderate",
      limitations: ["Morning SPY gamma incomplete (dated snapshot)"],
      missingTopics: [],
    });
    expect(critique.failed.length).toBe(0);
    expect(error.source).toBe("none");
  });

  it("adequate data + buy stance vs down session → model", () => {
    const snapshot = { ...baseSnapshot(), stance: "buy" as const };
    const context = makeContext(snapshot, {
      open: 771,
      high: 772,
      low: 768,
      close: 769,
    }, { rodInside: true, direction: "down" });
    const critique = deriveDailyReviewThesisCritique(context);
    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "high",
      limitations: [],
      missingTopics: [],
    });
    expect(critique.failed.some((line) => /Buy stance conflicted/i.test(line))).toBe(
      true,
    );
    expect(error.source).toBe("model");
  });

  it("genuine regime transition: morning above flip, close below flip", () => {
    const snapshot = baseSnapshot({ spot: 773, gammaFlip: 772 });
    const context = makeContext(snapshot, {
      open: 771,
      high: 772,
      low: 769,
      close: 770,
    }, {
      flipTouched: true,
      rodInside: true,
      direction: "down",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "high",
      limitations: [],
      missingTopics: [],
    });
    expect(
      critique.failed.some((line) => /closed below gamma flip 772/i.test(line)),
    ).toBe(true);
    expect(error.source).toBe("regime");
  });

  it("amplifying: close above call wall but still below flip — consistent, not regime", () => {
    const snapshot = {
      ...baseSnapshot({
        spot: 772.51,
        callWall: 772,
        putWall: 771,
        gammaFlip: 775.5,
        dealerFlow: "Amplifying / trend-following dealer flow",
        restOfDayRange: {
          status: "unavailable",
          lower: null,
          upper: null,
          confidencePct: null,
        },
      }),
      ctaProxy: { signal: "neutral", contextLine: "no tilt" },
    };
    const context = makeContext(snapshot, {
      open: 774.73,
      high: 774.74,
      low: 771.3,
      close: 772.54,
    }, {
      callWallTouched: true,
      rodInside: null,
      direction: "down",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(critique.failed.length).toBe(0);
    expect(
      critique.worked.some((line) =>
        /consistent with amplifying upside chase/i.test(line),
      ),
    ).toBe(true);
    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "moderate",
      limitations: [],
      missingTopics: [],
    });
    expect(error.source).toBe("none");
  });

  it("amplifying: close below put wall but still below flip — consistent chase", () => {
    const snapshot = {
      ...baseSnapshot({
        spot: 772,
        callWall: 775,
        putWall: 771,
        gammaFlip: 778,
        dealerFlow: "Amplifying / trend-following dealer flow",
        restOfDayRange: {
          status: "unavailable",
          lower: null,
          upper: null,
          confidencePct: null,
        },
      }),
      ctaProxy: { signal: "neutral", contextLine: "no tilt" },
    };
    const context = makeContext(snapshot, {
      open: 773,
      high: 774,
      low: 770,
      close: 770.5,
    }, {
      putWallTouched: true,
      rodInside: null,
      direction: "down",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(critique.failed.length).toBe(0);
    expect(
      critique.worked.some((line) =>
        /consistent with amplifying downside pressure/i.test(line),
      ),
    ).toBe(true);
    expect(
      classifyDailyReviewErrorSource(critique, {
        interpretationConfidence: "high",
        limitations: [],
        missingTopics: [],
      }).source,
    ).toBe("none");
  });

  it("regime transition: morning below flip → close above flip", () => {
    const snapshot = baseSnapshot({
      spot: 770,
      gammaFlip: 772,
      dealerFlow: "Amplifying / trend-following dealer flow",
    });
    const context = makeContext(snapshot, {
      open: 771,
      high: 774,
      low: 770,
      close: 773,
    }, {
      flipTouched: true,
      rodInside: null,
      direction: "up",
    });
    const critique = deriveDailyReviewThesisCritique(context);
    expect(
      critique.failed.some((line) =>
        /closed above gamma flip 772 after morning spot was below/i.test(line),
      ),
    ).toBe(true);
    expect(
      classifyDailyReviewErrorSource(critique, {
        interpretationConfidence: "high",
        limitations: [],
        missingTopics: [],
      }).source,
    ).toBe("regime");
  });
});

describe("v2 daily review interpret", () => {
  it("builds payload with thesis critique and close-vs-level flags", async () => {
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
      now: easternWallToUtc("2026-08-12", 14, 0, 0),
    });
    const context = makeContext(
      baseSnapshot(),
      { open: 769, high: 776, low: 767, close: 771 },
      {
        callWallTouched: true,
        putWallTouched: true,
        rodInside: true,
        direction: "up",
      },
    );
    const payload = buildV2DailyReviewPayload(sampleReview(), context, view);
    expect(payload.sessionOutcome.spy.closeAboveCallWall).toBe(false);
    expect(payload.sessionOutcome.spy.closeBelowPutWall).toBe(false);
    expect(payload.thesisCritique.failed.length).toBe(0);
  });

  it("fallback uses thesis critique not raw touch failures", () => {
    const context = makeContext(
      baseSnapshot(),
      { open: 769, high: 776, low: 767, close: 771 },
      {
        callWallTouched: true,
        putWallTouched: true,
        rodInside: true,
        direction: "up",
      },
    );
    const review = {
      ...sampleReview(),
      whatFailed: ["SPY call wall 775 was touched intraday"],
    };
    const payload = buildV2DailyReviewPayload(review, context, {
      spyBreadth: { stale: false, marketSessionDate: null },
      gamma: [
        {
          freshness: "fresh",
          status: "ready",
          dataLabel: null,
          sessionDate: null,
        },
        {},
      ],
    } as unknown as import("@/desk/v2-command-center").V2CommandCenterView);
    const fallback = buildV2DailyReviewFallback(review, payload, context);
    expect(fallback.whatFailed.some((line) => /touched intraday/i.test(line))).toBe(
      false,
    );
    expect(fallback.errorSource).toBe("none");
    expect(fallback.errorExplanation.length).toBeGreaterThan(0);
  });

  it("rejects invented sector symbols in LLM output", () => {
    const payload: V2DailyReviewPayload = {
      promptVersion: "0.2.0",
      sessionDate: "2026-08-12",
      morningThesis: {
        stance: "hold",
        stabilizingDealerFlow: true,
        amplifyingDealerFlow: false,
        rodPublished: true,
        morningSpotAboveFlip: false,
      },
      morningSnapshot: {
        stance: "hold",
        riskScore: 47,
        exposure: { min: 60, max: 75 },
        spy: baseSnapshot().spy,
        qqq: {
          spot: 400,
          callWall: 405,
          putWall: 395,
          gammaFlip: 398,
          dealerFlow: null,
        },
        breadth: baseSnapshot().breadth,
        ctaProxy: baseSnapshot().ctaProxy,
        volMispricing: baseSnapshot().volMispricing,
        sectorRotation: baseSnapshot().sectorRotation,
      },
      sessionOutcome: {
        actualOutcome: "SPY closed 771",
        spy: {
          open: 769,
          high: 776,
          low: 767,
          close: 771,
          direction: "up",
          callWallTouched: true,
          putWallTouched: false,
          flipTouched: true,
          rodInside: true,
          closeAboveCallWall: false,
          closeBelowPutWall: false,
          closeAboveFlip: false,
          closeBelowFlip: true,
        },
        qqq: null,
      },
      thesisCritique: { worked: [], failed: ["test"], watch: [] },
      dataQuality: {
        interpretationConfidence: "moderate",
        limitations: [],
        missingTopics: [],
      },
    };
    const result = validateV2DailyReviewLlmGrounding(
      {
        what_worked: "XLB leadership worked.",
        what_failed: "Call wall touch failed.",
        error_source: "regime",
        error_explanation: "Sector miss",
        tomorrow_watch: "Watch SPY flip.",
      },
      payload,
    );
    expect(result.ok).toBe(false);
  });

  it("production snapshot 2026-08-12: amplifying chase above call wall is not regime", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const snapshotPath = join(
      process.cwd(),
      "data",
      "command-center-v1",
      "2026-08-12.json",
    );
    const spyBarPath = join(
      process.cwd(),
      "data",
      "bars",
      "spy-universe",
      "SPY.json",
    );
    if (!existsSync(snapshotPath) || !existsSync(spyBarPath)) {
      return;
    }

    const morningSnapshot = JSON.parse(
      readFileSync(snapshotPath, "utf8"),
    ) as CommandCenterV1DailySnapshot;
    const spySeries = JSON.parse(readFileSync(spyBarPath, "utf8")) as {
      bars: Array<{
        sessionDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
    };
    const spyBar = spySeries.bars.find((bar) => bar.sessionDate === "2026-08-12");
    if (!spyBar) return;

    const context = makeContext(morningSnapshot, spyBar, {
      callWallTouched: spyBar.high >= (morningSnapshot.spy.callWall ?? 0),
      putWallTouched:
        morningSnapshot.spy.putWall !== null &&
        spyBar.low <= morningSnapshot.spy.putWall,
      flipTouched:
        morningSnapshot.spy.gammaFlip !== null &&
        spyBar.low <= morningSnapshot.spy.gammaFlip &&
        spyBar.high >= morningSnapshot.spy.gammaFlip,
      rodInside: null,
      direction: spyBar.close < spyBar.open ? "down" : "up",
    });

    const critique = deriveDailyReviewThesisCritique(context);
    expect(
      critique.failed.some((line) => /touched intraday/i.test(line)),
    ).toBe(false);
    expect(
      critique.failed.some((line) => /closed at\/above call wall/i.test(line)),
    ).toBe(false);
    expect(
      critique.worked.some((line) => /amplifying upside chase/i.test(line)),
    ).toBe(true);

    const error = classifyDailyReviewErrorSource(critique, {
      interpretationConfidence: "moderate",
      limitations: ["QQQ session bar unavailable for cross-check"],
      missingTopics: ["qqqSessionBar"],
    });
    expect(error.source).toBe("none");
  });
});
