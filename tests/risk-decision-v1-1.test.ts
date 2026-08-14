import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { V2GammaSummary, V2SpyBreadthSummary } from "@/desk/v2-command-center";
import {
  classifyRiskDivergenceTrend,
  computeRiskDivergence,
  deriveRiskDecisionV1_1,
  deriveStructuralRiskV1,
  unavailableQqqBreadthSummary,
  publishRiskDecisionV1_1Daily,
  loadPriorPublishedRiskDivergence,
  resolveRiskDivergenceDayOverDay,
  RISK_DECISION_V1_1_VERSION,
} from "@/desk/risk-decision-v1-1";
import type { CtaProxySummary } from "@/desk/format-gamma";

const driver = fixtureDriver as DominantDriver;

function strongSpyBreadth(): V2SpyBreadthSummary {
  return {
    status: "available",
    stale: false,
    marketSessionDate: "2026-08-10",
    asOf: "2026-08-10T20:00:00.000Z",
    advance: 320,
    decline: 180,
    unchanged: 12,
    percentAboveMA20: 62,
    percentAboveMA50: 55,
    new20DayClosingHigh: 18,
    new20DayClosingLow: 5,
    missingReason: null,
    sourceArtifact: "fixture",
    advancingPct: 62,
    breadthSignal: "strong",
    breadthSignalStatus: "available",
    breadthContextLine: "62% advancing",
  };
}

function gammaSummary(
  symbol: "SPY" | "QQQ",
  overrides: Partial<V2GammaSummary> = {},
): V2GammaSummary {
  return {
    symbol,
    status: "ready",
    freshness: "fresh",
    sessionDate: "2026-08-10",
    expiration: "2026-08-11",
    spot: symbol === "SPY" ? 550 : 480,
    putWall: 540,
    callWall: 560,
    gammaFlip: 548,
    netGex: 1_000_000,
    regime: "positive",
    dataLabel: "fixture",
    dealerFlowRegime: "Stabilizing",
    contextLines: [],
    callWallTouch: { status: "unavailable", percent: null },
    putWallTouch: { status: "unavailable", percent: null },
    restOfDayRange: {
      status: "unavailable",
      lower: null,
      upper: null,
      confidencePct: null,
    },
    volMispricing: {
      status: "available",
      ivPct: 18,
      hv20Pct: 14,
      spreadVolPts: 4,
      signal: "vol_expensive",
      ivDataLabel: "fixture",
    },
    quality: "fixture",
    source: "fixture",
    isFixture: true,
    ...overrides,
  };
}

const buyingCta: CtaProxySummary = {
  status: "available",
  signal: "buying",
  contextLine: "SPY above MA20 & MA50",
  triggerLines: [],
};

const neutralCta: CtaProxySummary = {
  status: "available",
  signal: "neutral",
  contextLine: "Mixed vs MA20/MA50",
  triggerLines: [],
};

const clearEventGate: EventGateSnapshot = {
  kind: "EventGate",
  schemaVersion: "0.1.0",
  state: "clear",
  asOf: "2026-08-10T14:00:00.000Z",
  marketSessionDate: "2026-08-10",
  activeEvents: [],
  nextEvent: null,
  windowStart: null,
  windowEnd: null,
  source: {
    provider: "official_calendar",
    artifact: "fixture",
    fetchedAt: "2026-08-10T12:00:00.000Z",
  },
  status: "available",
  stale: false,
  missingReason: null,
};

function linearBars(
  count: number,
  lastSession: string,
  startClose: number,
  endClose: number,
): { sessionDate: string; close: number }[] {
  const end = new Date(`${lastSession}T12:00:00Z`);
  const bars: { sessionDate: string; close: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - (count - 1 - index));
    const sessionDate = date.toISOString().slice(0, 10);
    const close =
      startClose + ((endClose - startClose) * index) / Math.max(count - 1, 1);
    bars.push({ sessionDate, close });
  }
  return bars;
}

describe("deriveRiskDecisionV1_1", () => {
  it("computes QQQ structural risk higher than SPY when QQQ gamma is negative", () => {
    const spyBreadth = strongSpyBreadth();
    const qqqBreadth = unavailableQqqBreadthSummary();
    const spyGamma = gammaSummary("SPY", { regime: "positive" });
    const qqqGamma = gammaSummary("QQQ", {
      regime: "negative",
      dealerFlowRegime: "Amplifying",
      volMispricing: {
        status: "available",
        ivPct: 22,
        hv20Pct: 14,
        spreadVolPts: 8,
        signal: "vol_expensive",
        ivDataLabel: "fixture",
      },
    });

    const result = deriveRiskDecisionV1_1({
      driver,
      spyBreadth,
      qqqBreadth,
      spyGamma,
      qqqGamma,
      marketCtaProxy: buyingCta,
      spyCtaProxy: buyingCta,
      qqqCtaProxy: neutralCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
    });

    expect(result.spyStructuralRisk.status).toBe("ready");
    expect(result.qqqStructuralRisk.status).toBe("ready");
    expect(result.spyStructuralRisk.riskScore).not.toBeNull();
    expect(result.qqqStructuralRisk.riskScore).not.toBeNull();
    expect(result.qqqStructuralRisk.riskScore!).toBeGreaterThan(
      result.spyStructuralRisk.riskScore!,
    );
    expect(result.riskDivergence).toBeGreaterThan(0);
    expect(result.componentDivergence.gammaRegime.label).toBe(
      "positive vs negative",
    );
  });

  it("computes QQQ structural risk lower than SPY when QQQ inputs are more benign", () => {
    const spyBreadth = {
      ...strongSpyBreadth(),
      breadthSignal: "weak" as const,
      advancingPct: 35,
      breadthContextLine: "35% advancing",
    };
    const spyGamma = gammaSummary("SPY", {
      regime: "negative",
      volMispricing: {
        status: "available",
        ivPct: 22,
        hv20Pct: 14,
        spreadVolPts: 8,
        signal: "vol_expensive",
        ivDataLabel: "fixture",
      },
    });
    const qqqGamma = gammaSummary("QQQ", {
      regime: "positive",
      volMispricing: {
        status: "available",
        ivPct: 16,
        hv20Pct: 15,
        spreadVolPts: 1,
        signal: "balanced",
        ivDataLabel: "fixture",
      },
    });

    const result = deriveRiskDecisionV1_1({
      driver,
      spyBreadth,
      qqqBreadth: unavailableQqqBreadthSummary(),
      spyGamma,
      qqqGamma,
      marketCtaProxy: neutralCta,
      spyCtaProxy: neutralCta,
      qqqCtaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
    });

    expect(result.spyStructuralRisk.riskScore!).toBeGreaterThan(
      result.qqqStructuralRisk.riskScore!,
    );
    expect(result.riskDivergence).toBeLessThan(0);
  });

  it("classifies widening and narrowing divergence trends", () => {
    expect(classifyRiskDivergenceTrend(5)).toBe("widening");
    expect(classifyRiskDivergenceTrend(-6)).toBe("narrowing");
    expect(classifyRiskDivergenceTrend(1)).toBe("stable");
    expect(classifyRiskDivergenceTrend(null)).toBeNull();
  });

  it("tracks divergence change when prior published record exists", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "risk-v1-1-"));
    publishRiskDecisionV1_1Daily(dataRoot, {
      schemaVersion: RISK_DECISION_V1_1_VERSION,
      publicationDate: "2026-08-09",
      marketSessionDate: "2026-08-08",
      generatedAt: "2026-08-09T12:00:00.000Z",
      spyStructuralRiskScore: 48,
      qqqStructuralRiskScore: 60,
      riskDivergence: 12,
    });

    const prior = loadPriorPublishedRiskDivergence(dataRoot, "2026-08-10");
    expect(prior).toBe(12);

    const spyGamma = gammaSummary("SPY", { regime: "positive" });
    const qqqGamma = gammaSummary("QQQ", { regime: "negative" });
    const result = deriveRiskDecisionV1_1({
      driver,
      spyBreadth: strongSpyBreadth(),
      qqqBreadth: unavailableQqqBreadthSummary(),
      spyGamma,
      qqqGamma,
      marketCtaProxy: buyingCta,
      spyCtaProxy: buyingCta,
      qqqCtaProxy: neutralCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
      priorDivergence: prior,
    });

    expect(result.riskDivergenceChange).toBe(result.riskDivergence! - 12);
    expect(result.riskDivergenceTrend).toBe("widening");

    const dayOverDay = resolveRiskDivergenceDayOverDay({
      dataRoot,
      publicationDate: "2026-08-10",
      decisionSessionDate: "2026-08-10",
      result,
      now: new Date("2026-08-10T20:00:00.000Z"),
      force: true,
    });
    expect(dayOverDay.priorDivergence).toBe(12);
    expect(dayOverDay.change).toBe(result.riskDivergence! - 12);
  });

  it("withholds QQQ structural risk when QQQ gamma and CTA are unavailable", () => {
    const unavailableQqqGamma = gammaSummary("QQQ", {
      status: "unavailable",
      freshness: null,
      regime: null,
      dealerFlowRegime: null,
      volMispricing: {
        status: "unavailable",
        ivPct: null,
        hv20Pct: null,
        spreadVolPts: null,
        signal: null,
        ivDataLabel: null,
      },
    });
    const unavailableCta: CtaProxySummary = {
      status: "unavailable",
      signal: null,
      contextLine: null,
      triggerLines: [],
    };

    const result = deriveStructuralRiskV1({
      driver,
      breadth: unavailableQqqBreadthSummary(),
      gamma: unavailableQqqGamma,
      ctaProxy: unavailableCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
    });

    expect(result.status).toBe("withheld");
    expect(result.riskScore).toBeNull();
  });

  it("shows unavailable divergence when either structural score is withheld", () => {
    const result = deriveRiskDecisionV1_1({
      driver: null,
      spyBreadth: {
        ...strongSpyBreadth(),
        breadthSignalStatus: "unavailable",
        breadthSignal: null,
      },
      qqqBreadth: unavailableQqqBreadthSummary(),
      spyGamma: gammaSummary("SPY"),
      qqqGamma: gammaSummary("QQQ", {
        status: "unavailable",
        regime: null,
        volMispricing: {
          status: "unavailable",
          ivPct: null,
          hv20Pct: null,
          spreadVolPts: null,
          signal: null,
          ivDataLabel: null,
        },
      }),
      marketCtaProxy: buyingCta,
      spyCtaProxy: buyingCta,
      qqqCtaProxy: {
        status: "unavailable",
        signal: null,
        contextLine: null,
        triggerLines: [],
      },
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
    });

    expect(computeRiskDivergence(50, null)).toBeNull();
    expect(result.riskDivergence).toBeNull();
    expect(result.riskDivergenceTrend).toBeNull();
    expect(result.qqqStructuralRisk.status).toBe("withheld");
  });

  it("builds component divergence for relative performance and IV spread", () => {
    const spyBars = linearBars(25, "2026-08-10", 500, 505);
    const qqqBars = linearBars(25, "2026-08-10", 400, 412);
    const equityBars = new Map([
      ["SPY", spyBars],
      ["QQQ", qqqBars],
    ]);

    const spyGamma = gammaSummary("SPY", {
      volMispricing: {
        status: "available",
        ivPct: 18,
        hv20Pct: 14,
        spreadVolPts: 4,
        signal: "vol_expensive",
        ivDataLabel: "fixture",
      },
    });
    const qqqGamma = gammaSummary("QQQ", {
      regime: "negative",
      volMispricing: {
        status: "available",
        ivPct: 24,
        hv20Pct: 16,
        spreadVolPts: 8,
        signal: "vol_expensive",
        ivDataLabel: "fixture",
      },
    });

    const result = deriveRiskDecisionV1_1({
      driver,
      spyBreadth: strongSpyBreadth(),
      qqqBreadth: unavailableQqqBreadthSummary(),
      spyGamma,
      qqqGamma,
      marketCtaProxy: buyingCta,
      spyCtaProxy: buyingCta,
      qqqCtaProxy: neutralCta,
      eventGate: clearEventGate,
      targetSession: "2026-08-10",
      equityBarsBySymbol: equityBars,
    });

    expect(result.componentDivergence.ivHvSpread.spreadDivergencePts).toBe(4);
    expect(result.componentDivergence.relativePerformance.qqqVsSpy1dPct).not.toBeNull();
    expect(result.componentDivergence.breadth.label).toContain("QQQ unavailable");
  });
});
