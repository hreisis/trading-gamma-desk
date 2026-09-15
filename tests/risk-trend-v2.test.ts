import { describe, expect, it } from "vitest";
import {
  deriveRiskTrendV2,
  type RiskTrendSnapshot,
} from "@/desk/risk-trend-v2";

function snapshot(
  overrides: Partial<RiskTrendSnapshot> & Pick<RiskTrendSnapshot, "sessionDate">,
): RiskTrendSnapshot {
  return {
    riskScore: 50,
    breadthSignal: "mixed",
    advancingPct: 50,
    macroScore: 55,
    macroDirection: "mixed",
    gammaRegime: "near_zero",
    volSignal: "balanced",
    volSpread: 0,
    ...overrides,
  };
}

describe("deriveRiskTrendV2", () => {
  it("labels improving when risk and structure both ease vs the prior session", () => {
    const result = deriveRiskTrendV2({
      priorDate: "2026-08-13",
      prior: snapshot({
        sessionDate: "2026-08-13",
        riskScore: 62,
        breadthSignal: "weak",
        gammaRegime: "negative",
      }),
      current: snapshot({
        sessionDate: "2026-08-14",
        riskScore: 38,
        breadthSignal: "mixed",
        gammaRegime: "positive",
      }),
    });
    expect(result.trend).toBe("improving");
    expect(result.reasons.some((reason) => /Risk 62 → 38/.test(reason))).toBe(
      true,
    );
  });

  it("labels deteriorating when risk and internals both worsen", () => {
    const result = deriveRiskTrendV2({
      priorDate: "2026-08-18",
      prior: snapshot({
        sessionDate: "2026-08-18",
        riskScore: 35,
        breadthSignal: "mixed",
        gammaRegime: "positive",
        volSpread: -1.2,
      }),
      current: snapshot({
        sessionDate: "2026-08-19",
        riskScore: 62,
        breadthSignal: "weak",
        gammaRegime: "negative",
        volSpread: 0.3,
      }),
    });
    expect(result.trend).toBe("deteriorating");
    expect(result.reasons.some((reason) => /Risk 35 → 62/.test(reason))).toBe(true);
  });

  it("stays stable when only one driver moves", () => {
    const result = deriveRiskTrendV2({
      priorDate: "2026-08-20",
      prior: snapshot({ sessionDate: "2026-08-20", riskScore: 50 }),
      current: snapshot({ sessionDate: "2026-08-21", riskScore: 58 }),
    });
    expect(result.trend).toBe("stable");
  });

  it("stays stable without a prior completed session", () => {
    const result = deriveRiskTrendV2({
      priorDate: null,
      prior: null,
      current: snapshot({ sessionDate: "2026-07-27" }),
    });
    expect(result.trend).toBe("stable");
    expect(result.reasons[0]).toMatch(/No prior completed session/);
  });

  it("ignores unused macro instead of inventing a move", () => {
    const result = deriveRiskTrendV2({
      priorDate: "2026-08-20",
      prior: snapshot({
        sessionDate: "2026-08-20",
        macroScore: null,
        macroDirection: null,
        riskScore: 50,
        breadthSignal: "mixed",
        gammaRegime: "negative",
        volSpread: 0,
      }),
      current: snapshot({
        sessionDate: "2026-08-21",
        macroScore: null,
        macroDirection: null,
        riskScore: 50,
        breadthSignal: "mixed",
        gammaRegime: "negative",
        volSpread: 0.2,
      }),
    });
    expect(result.trend).toBe("stable");
    expect(result.reasons.join(" ")).not.toMatch(/Macro/);
  });
});
