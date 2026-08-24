import { describe, expect, it } from "vitest";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import {
  deriveOpportunityScoreV2,
  OPPORTUNITY_V2_WEIGHTS,
} from "@/desk/opportunity-score-v2";
import type { VolMispricingSummary } from "@/desk/format-gamma";

const balancedVol: VolMispricingSummary = {
  status: "available",
  ivPct: 14,
  hv20Pct: 14,
  spreadVolPts: 0,
  signal: "balanced",
  ivDataLabel: "test",
};

const clearGate: EventGateSnapshot = {
  kind: "EventGate",
  schemaVersion: "0.1.0",
  state: "clear",
  asOf: "2026-08-10T20:00:00.000Z",
  marketSessionDate: "2026-08-10",
  activeEvents: [],
  nextEvent: null,
  windowStart: null,
  windowEnd: null,
  source: { provider: "test", artifact: "test", fetchedAt: "2026-08-10T12:00:00.000Z" },
  status: "available",
  stale: false,
  missingReason: null,
};

describe("deriveOpportunityScoreV2", () => {
  it("scores more opportunity when spot is below the gamma flip", () => {
    const below = deriveOpportunityScoreV2({
      spyGamma: {
        status: "ready",
        spot: 97,
        gammaFlip: 100,
        regime: "negative",
        volMispricing: balancedVol,
      },
    });
    const above = deriveOpportunityScoreV2({
      spyGamma: {
        status: "ready",
        spot: 103,
        gammaFlip: 100,
        regime: "negative",
        volMispricing: balancedVol,
      },
    });
    const belowFlip = below.factors.find((row) => row.id === "dislocation")?.score ?? 0;
    const aboveFlip = above.factors.find((row) => row.id === "dislocation")?.score ?? 0;
    expect(belowFlip).toBeGreaterThan(aboveFlip);
  });

  it("treats weak breadth as more of a washout than strong breadth", () => {
    const weak = deriveOpportunityScoreV2({
      breadth: {
        breadthSignalStatus: "available",
        breadthSignal: "weak",
        advancingPct: 27,
      },
    });
    const strong = deriveOpportunityScoreV2({
      breadth: {
        breadthSignalStatus: "available",
        breadthSignal: "strong",
        advancingPct: 72,
      },
    });
    expect(weak.factors.find((row) => row.id === "breadth_washout")?.score).toBe(73);
    expect(strong.factors.find((row) => row.id === "breadth_washout")?.score).toBe(28);
  });

  it("applies event risk as an opportunity penalty", () => {
    const clear = deriveOpportunityScoreV2({ eventGate: clearGate });
    const shock = deriveOpportunityScoreV2({
      eventGate: { ...clearGate, state: "active_shock" },
    });
    expect(clear.factors.find((row) => row.id === "event_risk")?.score).toBe(100);
    expect(shock.factors.find((row) => row.id === "event_risk")?.score).toBe(0);
  });

  it("renormalizes when factors are missing", () => {
    const result = deriveOpportunityScoreV2({
      eventGate: clearGate,
    });
    expect(result.coverage).toBe(OPPORTUNITY_V2_WEIGHTS.event_risk);
    expect(result.opportunityScore).toBe(100);
    expect(result.missing).toContain("dislocation");
    expect(result.missing).toContain("breadth_washout");
  });
});
