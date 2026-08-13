import { describe, expect, it } from "vitest";
import {
  computeLeadershipConcentrationPenalty,
  formatLeadershipConcentrationEvidence,
  LEADERSHIP_CONCENTRATION_PENALTY_CAP,
} from "@/desk/risk-leadership-concentration";
import type { V2SectorRotationRow } from "@/desk/v2-command-center";

function sectorRow(
  symbol: string,
  classification: V2SectorRotationRow["classification"],
  rs5d: number,
): V2SectorRotationRow {
  return {
    symbol,
    classification,
    return1d: 0,
    return5d: 0,
    return20d: 0,
    rs1d: 0,
    rs5d,
    rs20d: 0,
    aboveMa20: true,
    aboveMa50: true,
  };
}

describe("computeLeadershipConcentrationPenalty", () => {
  it("returns 0 for broad breadth and healthy sector participation", () => {
    const result = computeLeadershipConcentrationPenalty({
      breadth: {
        breadthSignalStatus: "available",
        advancingPct: 62,
        percentAboveMA20: 58,
        percentAboveMA50: 52,
        new20DayClosingHigh: 18,
        new20DayClosingLow: 5,
      },
      sectorRotation: {
        status: "available",
        stale: false,
        sessionDate: "2026-08-12",
        sectors: [
          sectorRow("XLK", "leading", 1.2),
          sectorRow("XLE", "leading", 0.8),
          sectorRow("XLV", "improving", 0.5),
          sectorRow("XLI", "improving", 0.4),
          sectorRow("XLF", "improving", 0.3),
          sectorRow("XLP", "improving", 0.2),
        ],
        topLeadingImproving: [],
        bottomWeakening: [],
        missingReason: null,
      },
    });

    expect(result.penalty).toBe(0);
    expect(result.reason).toBeNull();
  });

  it("caps breadth-only narrow participation at +3 when sector is stale", () => {
    const result = computeLeadershipConcentrationPenalty({
      breadth: {
        breadthSignalStatus: "available",
        advancingPct: 55,
        percentAboveMA20: 63,
        percentAboveMA50: 63,
        new20DayClosingHigh: 16,
        new20DayClosingLow: 6,
      },
      sectorRotation: {
        status: "available",
        stale: true,
        sessionDate: "2026-08-11",
        sectors: [],
        topLeadingImproving: [],
        bottomWeakening: [],
        missingReason: null,
      },
    });

    expect(result.penalty).toBe(3);
    expect(result.reason).toBe("narrow participation");
  });

  it("applies +6 when narrow advance, strong MA, and concentrated sector leadership", () => {
    const sectors = [
      sectorRow("XLE", "leading", 6),
      sectorRow("XLV", "leading", 2),
      sectorRow("XLK", "leading", 1),
      sectorRow("XLU", "improving", 0.1),
      sectorRow("XLP", "improving", -0.6),
      sectorRow("XLB", "neutral", -0.4),
      sectorRow("XLF", "neutral", -0.5),
      sectorRow("XLI", "neutral", -0.6),
      sectorRow("XLC", "neutral", -0.9),
      sectorRow("XLY", "neutral", -1),
      sectorRow("XLRE", "weakening", -1.9),
    ];

    const result = computeLeadershipConcentrationPenalty({
      breadth: {
        breadthSignalStatus: "available",
        advancingPct: 54.9,
        percentAboveMA20: 63.4,
        percentAboveMA50: 62.9,
        new20DayClosingHigh: 16.1,
        new20DayClosingLow: 6.6,
      },
      sectorRotation: {
        status: "available",
        stale: false,
        sessionDate: "2026-08-12",
        sectors,
        topLeadingImproving: [],
        bottomWeakening: [],
        missingReason: null,
      },
    });

    expect(result.penalty).toBe(6);
    expect(result.reason).toBe("narrow leadership");
  });

  it("never exceeds the cap", () => {
    const sectors = Array.from({ length: 11 }, (_, index) =>
      sectorRow(`S${index}`, "weakening", -2),
    );

    const result = computeLeadershipConcentrationPenalty({
      breadth: {
        breadthSignalStatus: "available",
        advancingPct: 40,
        percentAboveMA20: 65,
        percentAboveMA50: 65,
        new20DayClosingHigh: 10,
        new20DayClosingLow: 12,
      },
      sectorRotation: {
        status: "available",
        stale: false,
        sessionDate: "2026-08-12",
        sectors,
        topLeadingImproving: [],
        bottomWeakening: [],
        missingReason: null,
      },
    });

    expect(result.penalty).toBe(LEADERSHIP_CONCENTRATION_PENALTY_CAP);
  });
});

describe("formatLeadershipConcentrationEvidence", () => {
  it("formats the concentration evidence line", () => {
    expect(
      formatLeadershipConcentrationEvidence(6, "narrow leadership"),
    ).toBe("+6 concentration risk · narrow leadership");
    expect(formatLeadershipConcentrationEvidence(0, null)).toBeNull();
  });
});
