import { describe, expect, it } from "vitest";
import { describeMarketGammaState } from "@/app/components/v2/MarketDetailPreview";

describe("describeMarketGammaState", () => {
  it("does not call negative gamma or below-flip STABILIZING", () => {
    expect(
      describeMarketGammaState({ regime: "negative", spot: 640, gammaFlip: 630 }, "en")
        .title,
    ).toContain("AMPLIFYING");
    expect(
      describeMarketGammaState({ regime: "positive", spot: 620, gammaFlip: 630 }, "en")
        .title,
    ).toContain("AMPLIFYING");
    expect(
      describeMarketGammaState({ regime: "negative", spot: 620, gammaFlip: 630 }, "zh")
        .title,
    ).not.toContain("稳定");
  });

  it("uses STABILIZING only for positive gamma that is not below flip", () => {
    const state = describeMarketGammaState(
      { regime: "positive", spot: 640, gammaFlip: 630 },
      "en",
    );
    expect(state.kind).toBe("stabilizing");
    expect(state.title).toContain("STABILIZING");
  });

  it("treats near-zero above flip as transition, not stabilizing", () => {
    const state = describeMarketGammaState(
      { regime: "near_zero", spot: 631, gammaFlip: 630 },
      "en",
    );
    expect(state.kind).toBe("transition");
    expect(state.title).not.toContain("STABILIZING");
  });
});
