import { describe, expect, it } from "vitest";
import {
  deriveAssetRiskLight,
  deriveCatalystRiskLight,
  deriveDriverRiskLight,
  HIGH_BETA_RISK_WEIGHTS,
  RISK_LIGHT_BY_KIND,
} from "@/desk/risk-lights";

describe("deriveDriverRiskLight", () => {
  it("maps riskDirection to green / yellow / red", () => {
    expect(
      deriveDriverRiskLight({
        primaryRegime: "fed_rates",
        riskDirection: "risk_on",
        confidenceScore: 60,
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.green);

    expect(
      deriveDriverRiskLight({
        primaryRegime: "growth",
        riskDirection: "risk_off",
        confidenceScore: 55,
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.red);

    expect(
      deriveDriverRiskLight({
        primaryRegime: "inflation",
        riskDirection: "mixed",
        confidenceScore: 40,
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.yellow);
  });

  it("returns gray when data is insufficient", () => {
    expect(
      deriveDriverRiskLight({
        primaryRegime: "insufficient_data",
        riskDirection: "risk_on",
        confidenceScore: 10,
      }).kind,
    ).toBe("gray");

    expect(
      deriveDriverRiskLight({
        primaryRegime: "fed_rates",
        riskDirection: null,
        confidenceScore: 50,
      }).kind,
    ).toBe("gray");

    expect(
      deriveDriverRiskLight({
        primaryRegime: "fed_rates",
        riskDirection: "risk_on",
        confidenceScore: 0,
      }).kind,
    ).toBe("gray");

    expect(
      deriveDriverRiskLight({
        primaryRegime: "fed_rates",
        riskDirection: "risk_on",
        confidenceScore: 40,
        zeroedBy: "insufficient_data",
      }).kind,
    ).toBe("gray");
  });
});

describe("deriveAssetRiskLight", () => {
  it("does not color by bare price sign — uses risk weight × z", () => {
    // VIX down (negative z) with negative weight → supportive
    expect(
      deriveAssetRiskLight({
        symbol: "VIX",
        zScore: -1.2,
        role: "confirming",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.green);

    // VIX up → warning for high-beta
    expect(
      deriveAssetRiskLight({
        symbol: "VIX",
        zScore: 1.5,
        role: "confirming",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.red);

    // BTC up → supportive
    expect(
      deriveAssetRiskLight({
        symbol: "BTC",
        zScore: 0.9,
        role: "confirming",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.green);

    // GOLD down (haven softening) → supportive
    expect(
      deriveAssetRiskLight({
        symbol: "GOLD",
        zScore: -0.7,
        role: "contradicting",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.green);
  });

  it("returns gray for missing data, stale rows, or unmapped symbols", () => {
    expect(
      deriveAssetRiskLight({
        symbol: "BTC",
        zScore: null,
        role: "missing",
      }).kind,
    ).toBe("gray");

    expect(
      deriveAssetRiskLight({
        symbol: "US2Y",
        zScore: -1.8,
        role: "confirming",
      }).kind,
    ).toBe("gray");
    expect(HIGH_BETA_RISK_WEIGHTS.US2Y).toBeUndefined();

    expect(
      deriveAssetRiskLight({
        symbol: "BTC",
        zScore: 1.0,
        role: "confirming",
        staleDays: 2,
      }).kind,
    ).toBe("gray");
  });

  it("returns yellow for weak |z| below noise floor", () => {
    expect(
      deriveAssetRiskLight({
        symbol: "BTC",
        zScore: 0.3,
        role: "neutral",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.yellow);
  });
});

describe("deriveCatalystRiskLight", () => {
  it("uses equity breadth / leadership — not upcoming / missing reaction", () => {
    expect(
      deriveCatalystRiskLight({
        status: "upcoming",
        equityBreadth: "broadly_higher",
      }).kind,
    ).toBe("gray");

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: null,
      }).kind,
    ).toBe("gray");

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: "unavailable",
      }).kind,
    ).toBe("gray");

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: "broadly_higher",
        equityLeadershipStatus: "nasdaq_proxy_leads",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.green);

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: "broadly_lower",
        equityLeadershipStatus: "no_clear_leader",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.red);

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: "mixed",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.yellow);

    expect(
      deriveCatalystRiskLight({
        status: "released",
        equityBreadth: "broadly_higher",
        equityLeadershipStatus: "mixed",
      }),
    ).toEqual(RISK_LIGHT_BY_KIND.yellow);
  });
});
