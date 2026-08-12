import { describe, expect, it } from "vitest";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import {
  deriveRiskDecisionV1,
  type RiskDecisionSpyBreadthInput,
  type RiskDecisionSpyGammaInput,
} from "@/desk/risk-decision-v1";
import type { CtaProxySummary } from "@/desk/format-gamma";

const driver = fixtureDriver as DominantDriver;

function strongBreadth(stale = false): RiskDecisionSpyBreadthInput {
  return {
    breadthSignalStatus: "available",
    breadthSignal: "strong",
    breadthContextLine: "62% advancing · broad participation",
    stale,
  };
}

function spyGammaInput(
  overrides: Partial<RiskDecisionSpyGammaInput> = {},
): RiskDecisionSpyGammaInput {
  return {
    status: "incomplete",
    freshness: "stale",
    regime: "negative",
    dealerFlowRegime: "Amplifying / trend-following dealer flow",
    volMispricing: {
      status: "available",
      ivPct: 18,
      hv20Pct: 14,
      spreadVolPts: 4,
      signal: "vol_expensive",
      ivDataLabel: "Options IV · Jul 30 close",
    },
    ...overrides,
  };
}

const buyingCta: CtaProxySummary = {
  status: "available",
  signal: "buying",
  contextLine: "SPY & QQQ above MA20 & MA50 · systematic trend proxy",
  triggerLines: ["Sell pressure below 740"],
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
    artifact: "data/catalyst/calendar-latest.json",
    fetchedAt: "2026-08-10T12:00:00.000Z",
  },
  status: "available",
  stale: false,
  missingReason: null,
};

describe("deriveRiskDecisionV1", () => {
  it("withholds when effective model weight is below the minimum", () => {
    const result = deriveRiskDecisionV1({
      driver: null,
      spyBreadth: {
        breadthSignalStatus: "unavailable",
        breadthSignal: null,
        breadthContextLine: null,
        stale: false,
      },
      spyGamma: spyGammaInput({
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
      ctaProxy: {
        status: "unavailable",
        signal: null,
        contextLine: null,
        triggerLines: [],
      },
      eventGate: null,
      targetSession: "2026-08-10",
    });

    expect(result.status).toBe("withheld");
    expect(result.riskScore).toBeNull();
    expect(result.stance).toBeNull();
    expect(result.withheldFactors.length).toBeGreaterThan(0);
  });

  it("computes risk, stance, exposure, and allocation from connected inputs", () => {
    const result = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(),
      spyGamma: spyGammaInput(),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });

    expect(result.status).toBe("ready");
    expect(result.riskScore).not.toBeNull();
    if (result.riskScore === null) return;
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.stance).toMatch(/buy|hold|reduce/);
    expect(result.exposure).not.toBeNull();
    expect(result.allocation).not.toEqual(null);
    if (result.allocation) {
      expect(
        result.allocation.highBeta +
          result.allocation.defense +
          result.allocation.metals +
          result.allocation.hedge,
      ).toBe(100);
    }
    expect(result.opportunityScore).toBe(100 - result.riskScore);
    expect(result.evidence[0]).toMatch(/Structural risk/);
    expect(result.coverage?.factorsUsed.length).toBeGreaterThanOrEqual(4);
  });

  it("reduces stale factor weight instead of treating dated inputs as live", () => {
    const fresh = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(false),
      spyGamma: spyGammaInput({ freshness: "fresh" }),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });
    const stale = deriveRiskDecisionV1({
      driver,
      spyBreadth: strongBreadth(true),
      spyGamma: spyGammaInput({ freshness: "stale" }),
      ctaProxy: buyingCta,
      eventGate: clearEventGate,
      targetSession: "2026-07-28",
    });

    expect(fresh.status).toBe("ready");
    expect(stale.status).toBe("ready");
    if (
      fresh.riskScore === null ||
      stale.riskScore === null ||
      fresh.coverage === null ||
      stale.coverage === null
    ) {
      throw new Error("expected ready scores");
    }
    expect(stale.coverage.effectiveWeight).toBeLessThan(
      fresh.coverage.effectiveWeight,
    );
  });

  it("maps high risk to reduce stance and defensive allocation", () => {
    const result = deriveRiskDecisionV1({
      driver: {
        ...driver,
        riskDirection: "risk_off",
        label: "Risk-off (broad)",
        primaryRegime: "risk_sentiment",
      },
      spyBreadth: {
        breadthSignalStatus: "available",
        breadthSignal: "weak",
        breadthContextLine: "40% advancing · participation weakening",
        stale: false,
      },
      spyGamma: spyGammaInput({
        freshness: "fresh",
        regime: "negative",
        volMispricing: {
          status: "available",
          ivPct: 28,
          hv20Pct: 14,
          spreadVolPts: 14,
          signal: "vol_expensive",
          ivDataLabel: "Options IV · Aug 10 close",
        },
      }),
      ctaProxy: {
        status: "available",
        signal: "selling",
        contextLine: "SPY & QQQ below MA20 & MA50 · systematic trend proxy",
        triggerLines: [],
      },
      eventGate: {
        ...clearEventGate,
        state: "active_shock",
        activeEvents: [
          {
            catalystId: "cpi",
            kind: "cpi",
            headline: "CPI release",
            occurredAt: "2026-08-10T12:30:00.000Z",
            phase: "active_shock",
            windowStart: "2026-08-10T11:30:00.000Z",
            windowEnd: "2026-08-10T14:30:00.000Z",
          },
        ],
      },
      targetSession: "2026-08-10",
    });

    expect(result.status).toBe("ready");
    expect(result.stance).toBe("reduce");
    if (result.riskScore === null || result.allocation === null) {
      throw new Error("expected reduce allocation");
    }
    expect(result.riskScore).toBeGreaterThanOrEqual(66);
    expect(result.allocation.highBeta).toBeLessThan(result.allocation.defense);
    expect(result.allocation.hedge).toBeGreaterThan(15);
  });
});
