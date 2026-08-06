import { describe, expect, it } from "vitest";
import {
  buildV2CommandCenterView,
  loadBoundedGammaDeskView,
  type BoundedGammaDeskView,
} from "@/desk";

function unavailable(symbol: string): BoundedGammaDeskView {
  return {
    status: "empty",
    snapshot: null,
    sourceLabel: `${symbol} unavailable`,
    isFixture: false,
    error: { code: "empty", message: `${symbol} unavailable` },
  };
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

  it("summarizes SPY fixture but keeps an unavailable QQQ distinct", () => {
    const spy = loadBoundedGammaDeskView({ forceFixture: true });
    const view = buildV2CommandCenterView({
      driver: null,
      spyGamma: spy,
      qqqGamma: unavailable("QQQ"),
    });

    expect(view.gamma[0].symbol).toBe("SPY");
    expect(view.gamma[0].status).toBe("ready");
    expect(view.gamma[0].isFixture).toBe(true);
    expect(view.gamma[1]).toMatchObject({
      symbol: "QQQ",
      status: "unavailable",
      spot: null,
      callWall: null,
      putWall: null,
    });
  });
});

