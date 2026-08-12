import { describe, expect, it } from "vitest";
import {
  assignStructureAxisLanes,
  collectStructureAxisValues,
  riskGaugeNeedleAngle,
  structureAxisPercent,
  structureAxisScale,
} from "@/app/components/v2/CommandCenter";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import type { DominantDriver } from "@/contracts";
import {
  buildV2CommandCenterView,
  deriveBreadthActionableSignal,
  estimateRestOfDayRange,
  estimateWallTouchProbabilities,
  formatRestOfDayRangeLabel,
  summarizeCtaProxy,
  summarizeVolMispricing,
  loadBoundedGammaDeskView,
  applyBoundedGammaSessionGate,
  type BoundedGammaDeskView,
} from "@/desk";

function unavailable(symbol: string): BoundedGammaDeskView {
  return {
    status: "empty",
    snapshot: null,
    withheldSnapshot: null,
    sourceLabel: `${symbol} unavailable`,
    isFixture: false,
    error: { code: "empty", message: `${symbol} unavailable` },
  };
}

function linearEquityBars(
  count: number,
  lastSession: string,
  startClose: number,
  endClose: number,
): { sessionDate: string; close: number }[] {
  const end = new Date(`${lastSession}T12:00:00Z`);
  const bars: { sessionDate: string; close: number }[] = [];

  for (let index = 0; index < count; index += 1) {
    const session = new Date(end);
    session.setUTCDate(session.getUTCDate() - (count - 1 - index));
    const progress = count === 1 ? 1 : index / (count - 1);
    bars.push({
      sessionDate: session.toISOString().slice(0, 10),
      close: startClose + (endClose - startClose) * progress,
    });
  }

  return bars;
}

function readyMacroDriver(): DominantDriver {
  return fixtureDriver as DominantDriver;
}

function strongSpyBreadthSummary() {
  const base = {
    status: "available" as const,
    stale: false,
    marketSessionDate: "2026-07-28",
    asOf: "2026-07-29T08:00:00.000Z",
    advance: 420,
    decline: 180,
    unchanged: 100,
    percentAboveMA20: 62,
    percentAboveMA50: 56,
    new20DayClosingHigh: 18,
    new20DayClosingLow: 6,
    missingReason: null,
    sourceArtifact: "test-breadth",
    advancingPct: null,
    breadthSignal: null,
    breadthSignalStatus: "unavailable" as const,
    breadthContextLine: null,
  };
  return { ...base, ...deriveBreadthActionableSignal(base) };
}

describe("GammaDesk V2 command center", () => {
  it("withholds live stance, risk, exposure and allocation when inputs are missing", () => {
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: unavailable("SPY"),
      qqqGamma: unavailable("QQQ"),
    });

    expect(view.decisionStatus).toBe("awaiting_inputs");
    expect(view.stance).toBeNull();
    expect(view.riskScore).toBeNull();
    expect(view.exposure).toBeNull();
    expect(view.allocation).toBeNull();
    expect(view.missingInputs).toContain("Credit stress");
    expect(view.missingInputs).toContain("Breadth: Nasdaq / high-beta / semis");
    expect(view.spyBreadth.status).toBe("unavailable");
  });

  it("shows stale gamma walls and dealer flow from dated options snapshot", () => {
    const spyGamma = applyBoundedGammaSessionGate(
      loadBoundedGammaDeskView({ forceFixture: true }),
      "2026-08-10",
    );
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma,
      qqqGamma: unavailable("QQQ"),
    });

    expect(view.gamma[0].freshness).toBe("stale");
    expect(view.gamma[0].status).toBe("incomplete");
    expect(view.gamma[0].callWall).not.toBeNull();
    expect(view.gamma[0].putWall).not.toBeNull();
    expect(view.gamma[0].dealerFlowRegime).not.toBeNull();
    expect(view.gamma[0].dataLabel).toMatch(/Jul 30 close/);
    expect(view.gamma[0].callWallTouch.status).toBe("unavailable");
  });

  it("labels illustrative decision values as methodology preview", () => {
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: unavailable("SPY"),
      qqqGamma: unavailable("QQQ"),
      methodologyPreview: true,
    });

    expect(view.decisionStatus).toBe("methodology_preview");
    expect(view.riskScore).toBe(42);
    expect(view.exposure).toEqual({ min: 65, max: 80 });
    expect(view.allocation).toEqual({
      highBeta: 45,
      defense: 25,
      metals: 20,
      hedge: 10,
    });
  });

  it("populates live stance, risk, exposure, and allocation when core inputs connect", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const targetSession = "2026-07-28";
    const view = buildV2CommandCenterView({
      driver: readyMacroDriver(),
      spyGamma: spy,
      qqqGamma: unavailable("QQQ"),
      spyBreadth: strongSpyBreadthSummary(),
      now: easternWallToUtc(targetSession, 14, 0, 0),
      marketInputSnapshot: {
        kind: "MarketInputSnapshot",
        schemaVersion: "0.1.0",
        targetMarketSessionDate: targetSession,
        generatedAt: "2026-07-29T12:00:00-04:00",
        sessionAlignment: "aligned",
        isCompleteCrossSection: false,
        inputs: [
          {
            key: "event_gate",
            label: "Shock / event gate",
            value: {
              kind: "EventGate",
              schemaVersion: "0.1.0",
              state: "clear",
              asOf: "2026-07-29T12:00:00-04:00",
              marketSessionDate: targetSession,
              activeEvents: [],
              nextEvent: null,
              windowStart: null,
              windowEnd: null,
              source: {
                provider: "official_calendar",
                artifact: "data/catalyst/calendar-latest.json",
                fetchedAt: "2026-07-29T12:00:00-04:00",
              },
              status: "available",
              stale: false,
              missingReason: null,
            },
            asOf: "2026-07-29T12:00:00-04:00",
            marketSessionDate: targetSession,
            source: {
              provider: "catalyst",
              artifact: "data/catalyst/calendar-latest.json",
              fetchedAt: "2026-07-29T12:00:00-04:00",
            },
            status: "available",
            stale: false,
            missingReason: null,
            isProxy: false,
          },
        ],
        summary: {
          availableCount: 1,
          partialCount: 0,
          incompleteCount: 0,
          unavailableCount: 0,
          missingCount: 0,
          staleCount: 0,
          crossSessionCount: 0,
        },
      },
      equityBarsBySymbol: new Map([
        [
          "SPY",
          linearEquityBars(55, targetSession, 700, 780),
        ],
        [
          "QQQ",
          linearEquityBars(55, targetSession, 350, 390),
        ],
      ]),
      marketQuotes: [
        {
          symbol: "SPY",
          latestPrice: 785,
          dailyChangePct: 0.5,
          timestamp: "2026-07-29T12:00:00-04:00",
          source: "synthetic_demo",
          status: "available",
        },
        {
          symbol: "QQQ",
          latestPrice: 395,
          dailyChangePct: 0.4,
          timestamp: "2026-07-29T12:00:00-04:00",
          source: "synthetic_demo",
          status: "available",
        },
      ],
    });

    expect(view.decisionStatus).toBe("ready");
    expect(view.stance).not.toBeNull();
    expect(view.riskScore).not.toBeNull();
    expect(view.exposure).not.toBeNull();
    expect(view.allocation).not.toBeNull();
    expect(view.evidence[0]).toMatch(/Structural risk/);
    if (view.allocation) {
      expect(
        view.allocation.highBeta +
          view.allocation.defense +
          view.allocation.metals +
          view.allocation.hedge,
      ).toBe(100);
    }
  });

  it("keeps demo QQQ distinct from the SPY fixture", () => {
    const qqq = loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true });
    expect(qqq.status).toBe("empty");
    expect(qqq.snapshot).toBeNull();
    expect(qqq.isFixture).toBe(false);
  });

  it("summarizes SPY fixture as incomplete and keeps unavailable QQQ distinct", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: unavailable("QQQ"),
    });

    expect(view.gamma[0].symbol).toBe("SPY");
    expect(view.gamma[0].status).toBe("incomplete");
    expect(view.gamma[0].freshness).toBe("incomplete");
    expect(view.gamma[0].isFixture).toBe(true);
    expect(view.gamma[0].dataLabel).toBe("Fixture · Jul 30 close");
    expect(view.gamma[0].dealerFlowRegime).toBe(
      "Amplifying / trend-following dealer flow",
    );
    expect(view.gamma[0].netGex).toBeLessThan(0);
    expect(view.gamma[0].callWall).toBe(745);
    expect(view.gamma[0].putWall).toBe(743);
    expect(view.gamma[0].gammaFlip).toBe(745.9);
    expect(view.gamma[0].contextLines).toContain(
      "Below Put Wall → downside flush risk",
    );
    expect(view.gamma[0].callWallTouch.status).toBe("unavailable");
    expect(view.gamma[0].putWallTouch.status).toBe("unavailable");
    expect(view.gamma[0].volMispricing.ivDataLabel).toBe("Fixture IV · Jul 30 close");
    expect(view.gamma[0].volMispricing.status).toBe("unavailable");
    expect(view.gamma[0].volMispricing.ivPct).toBeNull();
    expect(view.gamma[1]).toMatchObject({
      symbol: "QQQ",
      status: "unavailable",
      spot: null,
      callWall: null,
      putWall: null,
    });
  });

  it("estimates wall touch from wall distance, vol, and remaining session time", () => {
    const now = easternWallToUtc("2026-08-11", 14, 0, 0);
    const touch = estimateWallTouchProbabilities({
      spot: 741.63,
      callWallStrike: 745,
      callWallAvailable: true,
      putWallStrike: 738,
      putWallAvailable: true,
      sessionDate: "2026-08-10",
      symbol: "SPY",
      now,
      dailyVolPct: 0.011,
    });

    expect(touch.callWallTouch.status).toBe("available");
    expect(touch.putWallTouch.status).toBe("available");
    expect(touch.callWallTouch.percent).toBeGreaterThan(0);
    expect(touch.putWallTouch.percent).toBeGreaterThan(0);
  });

  it("withholds wall touch after the regular session close", () => {
    const now = easternWallToUtc("2026-08-11", 16, 30, 0);
    const touch = estimateWallTouchProbabilities({
      spot: 741.63,
      callWallStrike: 745,
      callWallAvailable: true,
      putWallStrike: 738,
      putWallAvailable: true,
      sessionDate: "2026-08-10",
      symbol: "SPY",
      now,
      dailyVolPct: 0.011,
    });

    expect(touch.callWallTouch.status).toBe("unavailable");
    expect(touch.putWallTouch.status).toBe("unavailable");
  });

  it("estimates a 90% rest-of-day range from spot, vol, and remaining session", () => {
    const now = easternWallToUtc("2026-08-11", 14, 0, 0);
    const range = estimateRestOfDayRange({
      spot: 775,
      dailyVolPct: 0.011,
      now,
    });

    expect(range.status).toBe("available");
    expect(range.confidencePct).toBe(90);
    expect(range.lower).not.toBeNull();
    expect(range.upper).not.toBeNull();
    if (range.lower === null || range.upper === null) {
      throw new Error("expected range bounds");
    }
    expect(range.lower).toBeLessThan(775);
    expect(range.upper).toBeGreaterThan(775);
    expect(formatRestOfDayRangeLabel(range)).toMatch(/^\d+–\d+$/);
  });

  it("withholds rest-of-day range after the regular session close", () => {
    const now = easternWallToUtc("2026-08-11", 16, 30, 0);
    const range = estimateRestOfDayRange({
      spot: 775,
      dailyVolPct: 0.011,
      now,
    });

    expect(range.status).toBe("unavailable");
  });

  it("renders rest-of-day range from live spot when gamma levels are unavailable", () => {
    const now = easternWallToUtc("2026-08-11", 14, 0, 0);
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: unavailable("SPY"),
      qqqGamma: unavailable("QQQ"),
      now,
      marketQuotes: [
        {
          symbol: "SPY",
          latestPrice: 775,
          dailyChangePct: 0.5,
          timestamp: now.toISOString(),
          source: "synthetic_demo",
          status: "available",
        },
      ],
    });

    expect(view.gamma[0].restOfDayRange.status).toBe("available");
    expect(view.gamma[1].restOfDayRange.status).toBe("unavailable");
  });

  it("computes HV20 and classifies IV vs HV spread", () => {
    const bars = Array.from({ length: 25 }, (_, index) => ({
      sessionDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      close: 100 + index * 0.25 + Math.sin(index) * 0.5,
    }));
    const summary = summarizeVolMispricing({
      representativeIv: {
        status: "available",
        value: 0.2,
        sessionDate: "2026-07-30",
      },
      hv20Bars: bars,
      isFixture: false,
    });

    expect(summary.status).toBe("available");
    expect(summary.ivPct).toBe(20);
    expect(summary.hv20Pct).not.toBeNull();
    expect(summary.spreadVolPts).not.toBeNull();
    expect(summary.signal).toBe("vol_expensive");
    expect(summary.ivDataLabel).toBe("Options IV · Jul 30 close");
  });

  it("classifies CTA proxy as buying when SPY and QQQ trend above MA20/MA50", () => {
    const targetSession = "2026-08-10";
    const spyBars = linearEquityBars(55, targetSession, 700, 780);
    const qqqBars = linearEquityBars(55, targetSession, 350, 390);
    const summary = summarizeCtaProxy({
      spyBars,
      qqqBars,
      spyPrice: 785,
      qqqPrice: 395,
      targetSession,
    });

    expect(summary.status).toBe("available");
    expect(summary.signal).toBe("buying");
    expect(summary.contextLine).toContain("systematic trend proxy");
    expect(summary.triggerLines.some((line) => line.startsWith("Sell pressure below"))).toBe(
      true,
    );
  });

  it("classifies CTA proxy as selling when SPY and QQQ trend below MA20/MA50", () => {
    const targetSession = "2026-08-10";
    const spyBars = linearEquityBars(55, targetSession, 780, 700);
    const qqqBars = linearEquityBars(55, targetSession, 390, 350);
    const summary = summarizeCtaProxy({
      spyBars,
      qqqBars,
      spyPrice: 695,
      qqqPrice: 345,
      targetSession,
    });

    expect(summary.status).toBe("available");
    expect(summary.signal).toBe("selling");
    expect(summary.triggerLines.some((line) => line.startsWith("Buy reinforcement above"))).toBe(
      true,
    );
  });

  it("keeps CTA proxy neutral when SPY and QQQ disagree on trend", () => {
    const targetSession = "2026-08-10";
    const spyBars = linearEquityBars(55, targetSession, 700, 780);
    const qqqBars = linearEquityBars(55, targetSession, 390, 350);
    const summary = summarizeCtaProxy({
      spyBars,
      qqqBars,
      spyPrice: 785,
      qqqPrice: 345,
      targetSession,
    });

    expect(summary.status).toBe("available");
    expect(summary.signal).toBe("neutral");
  });

  it("withholds CTA proxy when equity bars are stale vs target session", () => {
    const spyBars = linearEquityBars(55, "2026-08-07", 700, 780);
    const qqqBars = linearEquityBars(55, "2026-08-07", 350, 390);
    const summary = summarizeCtaProxy({
      spyBars,
      qqqBars,
      spyPrice: 785,
      qqqPrice: 395,
      targetSession: "2026-08-10",
    });

    expect(summary.status).toBe("unavailable");
    expect(summary.signal).toBeNull();
  });

  it("withholds CTA proxy in command center view when bars are not loaded", () => {
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: unavailable("SPY"),
      qqqGamma: unavailable("QQQ"),
    });

    expect(view.ctaProxy.status).toBe("unavailable");
  });
});

describe("risk gauge needle mapping", () => {
  it("maps 0–100 linearly across the semicircle", () => {
    expect(riskGaugeNeedleAngle(0)).toBe(-180);
    expect(riskGaugeNeedleAngle(25)).toBe(-135);
    expect(riskGaugeNeedleAngle(50)).toBe(-90);
    expect(riskGaugeNeedleAngle(75)).toBe(-45);
    expect(riskGaugeNeedleAngle(100)).toBe(0);
  });

  it("places mid-range scores near center, not the right edge", () => {
    expect(riskGaugeNeedleAngle(51)).toBe(-88.2);
    expect(riskGaugeNeedleAngle(51)).toBeGreaterThan(-95);
    expect(riskGaugeNeedleAngle(51)).toBeLessThan(-85);
  });
});

describe("structure axis scale", () => {
  it("pads bounds from available levels and maps linearly", () => {
    const values = [738, 741.63, 743, 745, 745.9];
    const scale = structureAxisScale(values);
    expect(scale).not.toBeNull();
    if (!scale) return;

    expect(scale.min).toBeLessThan(738);
    expect(scale.max).toBeGreaterThan(745.9);
    expect(structureAxisPercent(738, scale)).toBeLessThan(
      structureAxisPercent(745.9, scale),
    );
    expect(structureAxisPercent(741.63, scale)).toBeGreaterThan(20);
    expect(structureAxisPercent(741.63, scale)).toBeLessThan(80);
  });

  it("collects spot, walls, flip, and rest-of-day bounds", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: unavailable("QQQ"),
    });
    const values = collectStructureAxisValues(view.gamma[0]);
    expect(values).toContain(741.63);
    expect(values).toContain(743);
    expect(values).toContain(745);
    expect(values).toContain(745.9);
    expect(values.length).toBeGreaterThanOrEqual(5);
  });

  it("stacks below-axis labels when wall markers are close", () => {
    const lanes = assignStructureAxisLanes([
      { id: "call", leftPct: 58 },
      { id: "flip", leftPct: 64 },
    ]);
    expect(lanes.call).toBe(0);
    expect(lanes.flip).toBe(1);
  });
});

