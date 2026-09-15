import { describe, expect, it } from "vitest";
import {
  classifyHygLqdCredit,
  deriveHygLqdCreditSignal,
} from "@/desk/hyg-lqd-credit";
import { buildV2AiStudyFallback, type V2AiStudyPayload } from "@/ai-study/v2-command-interpret";

function bar(sessionDate: string, close: number) {
  return { sessionDate, close };
}

function bars(closes: readonly [string, number][]) {
  return closes.map(([sessionDate, close]) => ({ sessionDate, close }));
}

describe("HYG/LQD credit signal", () => {
  it("computes ratio, 1D change, and 5D trend from aligned daily closes", () => {
    const dates = [
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-24",
    ] as const;
    const hyg = dates.map((date, index) => bar(date, 80 - index));
    const lqd = dates.map((date) => bar(date, 100));
    const spy = dates.map((date, index) => bar(date, 500 - index * 2));
    const result = deriveHygLqdCreditSignal({
      targetSession: "2026-08-24",
      equityBarsBySymbol: new Map([
        ["HYG", hyg],
        ["LQD", lqd],
        ["SPY", spy],
      ]),
    });

    expect(result.status).toBe("available");
    expect(result.ratio).toBe(0.75);
    expect(result.change1dPct).toBe(-1.32);
    expect(result.trend5dPct).toBe(-6.25);
    expect(result.signal).toBe("weakening");
    expect(result.spyChange1dPct).toBeLessThan(0);
  });

  it("classifies stable when 1D and 5D are inside the deadband", () => {
    expect(classifyHygLqdCredit(0.05, 0.1)).toBe("stable");
  });

  it("is unavailable without HYG/LQD bars", () => {
    const result = deriveHygLqdCreditSignal({
      targetSession: "2026-08-24",
      equityBarsBySymbol: new Map([
        ["SPY", bars([["2026-08-24", 500]])],
      ]),
    });
    expect(result.status).toBe("unavailable");
    expect(result.signal).toBeNull();
  });

  it("feeds Hidden Risk, Cross-Asset Conflict, and What Changed only", () => {
    const payload: V2AiStudyPayload = {
      promptVersion: "0.4.3",
      sessionDate: "2026-08-24",
      decision: {
        stance: "hold",
        riskScore: 55,
        riskChange: null,
        exposure: null,
        opportunityScore: 45,
        riskChangeReason: null,
      },
      creditHygLqd: {
        ratio: 0.75,
        change1dPct: -1.32,
        trend5dPct: -6.25,
        signal: "weakening",
        spyChange1dPct: -0.4,
        sessionDate: "2026-08-24",
      },
      dataQuality: {
        interpretationConfidence: "moderate",
        limitations: [],
        missingTopics: [],
      },
    };
    const fallback = buildV2AiStudyFallback(payload);
    expect(fallback.hiddenRisk).toContain("HYG/LQD");
    expect(fallback.hiddenRisk).toContain("credit risk appetite deteriorating");
    expect(fallback.crossAssetConflict).toContain("HYG/LQD");
    expect(fallback.whatChanged).toContain("1D -1.32%");
    expect(fallback.whatChanged).toContain("5D -6.25%");
    expect(fallback.reactionQuality).not.toContain("HYG/LQD");
    expect(fallback.regime).not.toContain("HYG/LQD");
  });

  it("reads stable/improving credit vs weaker equities as unconfirmed equity stress", () => {
    const payload: V2AiStudyPayload = {
      promptVersion: "0.4.3",
      sessionDate: "2026-08-24",
      decision: {
        stance: "hold",
        riskScore: 55,
        riskChange: null,
        exposure: null,
        opportunityScore: 45,
        riskChangeReason: null,
      },
      creditHygLqd: {
        ratio: 0.81,
        change1dPct: 0.2,
        trend5dPct: 0.5,
        signal: "improving",
        spyChange1dPct: -0.8,
        sessionDate: "2026-08-24",
      },
      dataQuality: {
        interpretationConfidence: "moderate",
        limitations: [],
        missingTopics: [],
      },
    };
    const fallback = buildV2AiStudyFallback(payload);
    expect(fallback.hiddenRisk).not.toContain("HYG/LQD");
    expect(fallback.crossAssetConflict).toContain(
      "equity stress not yet confirmed by credit",
    );
    expect(fallback.whatChanged).toContain("HYG/LQD improving");
  });
});
