import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Confidence,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "@/contracts";
import {
  BELOW_HIGH_CAP,
  Z_NOISE_FLOOR,
  classifyDriver,
  cosine,
  scoreRegime,
  weightedGeometricMean,
  type ScoreInput,
} from "@/macro";

const config = RegimeSignatureConfig.parse(
  JSON.parse(
    readFileSync(
      new URL("../fixtures/macro/regime-signature.sig-2026-07-01.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** Convenience: fill every symbol, override a few. */
function zInput(
  overrides: Partial<Record<MacroSymbol, number | null>>,
  opts: { stale?: MacroSymbol[] } = {},
): ScoreInput[] {
  const stale = new Set(opts.stale ?? []);
  const symbols: MacroSymbol[] = [
    "US2Y",
    "US10Y",
    "GOLD",
    "COPPER",
    "OIL",
    "USD",
    "VIX",
    "BTC",
  ];
  return symbols.map((symbol) => ({
    symbol,
    zScore: overrides[symbol] === undefined ? 0.1 : overrides[symbol]!,
    stale: stale.has(symbol),
  }));
}

describe("cosine is re-normalized on observed dimensions", () => {
  it("ignores dimensions without a z-score rather than treating them as zero", () => {
    const weights = { US2Y: 1, GOLD: 1 };
    const full = new Map<MacroSymbol, number>([
      ["US2Y", 1],
      ["GOLD", 0],
    ]);
    const partial = new Map<MacroSymbol, number>([["US2Y", 1]]);

    // With GOLD observed at 0 the template is diluted; with GOLD missing the
    // remaining weight is re-normalized and the match is perfect.
    expect(scoreRegime(weights, full)).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(scoreRegime(weights, partial)).toBeCloseTo(1, 9);
  });

  it("returns null for a zero z-vector instead of inventing a match", () => {
    const z = new Map<MacroSymbol, number>([
      ["US2Y", 0],
      ["US10Y", 0],
    ]);
    expect(scoreRegime({ US2Y: 1 }, z)).toBeNull();
  });
});

describe("weighted geometric mean", () => {
  it("returns an explicit zero when any component is not positive", () => {
    const { gate, zeroedIndex } = weightedGeometricMean([
      { value: 0.8, weight: 0.5 },
      { value: 0, weight: 0.5 },
    ]);
    expect(gate).toBe(0);
    expect(zeroedIndex).toBe(1);
  });

  it("matches the equal-weight geometric mean", () => {
    const { gate } = weightedGeometricMean([
      { value: 0.81, weight: 0.5 },
      { value: 0.25, weight: 0.5 },
    ]);
    expect(gate).toBeCloseTo(Math.sqrt(0.81 * 0.25), 12);
  });
});

describe("rates-led easing scenario", () => {
  // Mirrors the DominantDriver fixture's z-vector.
  const inputs = zInput({
    US2Y: -1.8,
    US10Y: -1.1,
    USD: -1.2,
    BTC: 0.9,
    GOLD: -0.7,
    VIX: -0.3,
    COPPER: 0.3,
    OIL: 0.2,
  });

  it("selects fed_rates with negative polarity", () => {
    const result = classifyDriver(inputs, config);
    expect(result.primaryRegime).toBe("fed_rates");
    expect(result.polarity).toBe("negative");
    expect(Confidence.safeParse(result.confidence).success).toBe(true);
  });

  it("marks confirming and contradicting by sign of w·z against the score", () => {
    const result = classifyDriver(inputs, config);
    const role = (s: MacroSymbol) =>
      result.contributions.find((c) => c.symbol === s)!.role;

    expect(role("US2Y")).toBe("confirming");
    expect(role("US10Y")).toBe("confirming");
    expect(role("USD")).toBe("confirming");
    expect(role("BTC")).toBe("confirming");
    expect(role("GOLD")).toBe("contradicting");
    // |z| = 0.3 is below the noise floor, so VIX cannot mint a confirmation.
    expect(role("VIX")).toBe("neutral");
    expect(Z_NOISE_FLOOR).toBe(0.5);
  });

  it("keeps contribution shares summing to one in absolute value", () => {
    const result = classifyDriver(inputs, config);
    const absSum = result.contributions.reduce(
      (s, c) => s + Math.abs(c.contribution),
      0,
    );
    expect(absSum).toBeCloseTo(1, 9);
  });
});

describe("hard rule: effectiveConfirmations < 2 caps below high", () => {
  it("a rates-only move cannot clear the high-band floor", () => {
    // Violent 2Y move, everything else quiet. Rates block alone confirms.
    const result = classifyDriver(
      zInput({
        US2Y: -4,
        US10Y: 0.1,
        GOLD: 0.1,
        COPPER: 0.1,
        OIL: 0.1,
        USD: 0.1,
        VIX: 0.1,
        BTC: 0.1,
      }),
      config,
    );

    expect(result.breadth.effectiveConfirmations).toBeLessThan(2);
    expect(result.confidence.score).toBeLessThanOrEqual(BELOW_HIGH_CAP);
    expect(
      result.confidence.hardCapsApplied.some(
        (c) => c.rule === "insufficient_effective_confirmations",
      ),
    ).toBe(true);
  });

  it("rates-block alone contributes at most one effective confirmation", () => {
    const result = classifyDriver(
      zInput({
        US2Y: -3,
        US10Y: -2.5,
        GOLD: 0.1,
        COPPER: 0.1,
        OIL: 0.1,
        USD: 0.1,
        VIX: 0.1,
        BTC: 0.1,
      }),
      config,
    );

    // Both yields confirm inside one block → confirmRatio 1, not 2.
    const ratesConfirming = result.contributions.filter(
      (c) =>
        (c.symbol === "US2Y" || c.symbol === "US10Y") &&
        c.role === "confirming",
    );
    expect(ratesConfirming.length).toBe(2);
    expect(result.breadth.effectiveConfirmations).toBeLessThan(2);
  });
});

describe("hard rule: single_asset_shock", () => {
  it("fires when one name dominates and breadth is thin", () => {
    const result = classifyDriver(
      zInput({
        US2Y: -8,
        US10Y: 0.05,
        GOLD: 0.05,
        COPPER: 0.05,
        OIL: 0.05,
        USD: 0.05,
        VIX: 0.05,
        BTC: 0.05,
      }),
      config,
    );

    expect(result.primaryRegime).toBe("single_asset_shock");
    expect(result.polarity).toBeNull();
    expect(result.riskDirection).toBeNull();
    expect(
      result.confidence.hardCapsApplied.some((c) => c.rule === "single_asset_shock"),
    ).toBe(true);
  });
});

describe("hard rule: mixed_unresolved", () => {
  it("fires when distinctiveness sits below the ambiguity floor", () => {
    // Raise the floor so any day with a real runner-up is ambiguous. This
    // tests the gate wiring, not the uncalibrated numeric threshold.
    const result = classifyDriver(
      zInput({
        US2Y: -1.5,
        US10Y: -1.2,
        USD: -1.2,
        BTC: 1.0,
        GOLD: -0.8,
        VIX: -0.8,
        COPPER: 0.6,
        OIL: 0.5,
      }),
      {
        ...config,
        confidenceParams: {
          ...config.confidenceParams,
          ambiguityFloor: 0.99,
        },
      },
    );

    expect(result.primaryRegime).toBe("mixed_unresolved");
    expect(result.polarity).toBeNull();
    expect(result.riskDirection).toBeNull();
    expect(
      result.confidence.hardCapsApplied.some((c) => c.rule === "mixed_unresolved"),
    ).toBe(true);
  });
});

describe("hard rule: insufficient_data", () => {
  it("fires when a core rate is missing", () => {
    const result = classifyDriver(
      zInput({
        US2Y: null,
        US10Y: -1,
        GOLD: -1,
        COPPER: 1,
        OIL: 1,
        USD: -1,
        VIX: -1,
        BTC: 1,
      }),
      config,
    );

    expect(result.primaryRegime).toBe("insufficient_data");
    expect(result.confidence.score).toBe(0);
    expect(result.polarity).toBeNull();
    expect(result.riskDirection).toBeNull();
    expect(
      result.confidence.hardCapsApplied.some((c) => c.rule === "insufficient_data"),
    ).toBe(true);
    expect(Confidence.safeParse(result.confidence).success).toBe(true);
  });

  it("fires when fewer than six core assets are present", () => {
    const result = classifyDriver(
      zInput({
        US2Y: -1,
        US10Y: -1,
        GOLD: -1,
        COPPER: 1,
        OIL: 1,
        USD: null,
        VIX: null,
        BTC: null,
      }),
      config,
    );
    expect(result.primaryRegime).toBe("insufficient_data");
    expect(result.confidence.score).toBe(0);
  });
});

describe("effectiveBreadth is exposure-weighted over scored blocks only", () => {
  it("does not charge a signature for blocks it places no weight on", () => {
    // fed_rates puts no weight on copper/oil. Commodity z-scores must not
    // change that winner's breadth accounting. Rates legs stay large enough
    // that a copper/oil pop cannot flip the regime under the placeholders.
    const base = {
      US2Y: -3,
      US10Y: -2,
      USD: -2,
      BTC: 1.5,
      GOLD: 0.1,
      VIX: 0.1,
    } as const;

    const quietCommodities = classifyDriver(
      zInput({ ...base, COPPER: 0.1, OIL: 0.1 }),
      config,
    );
    const loudCommodities = classifyDriver(
      zInput({ ...base, COPPER: 1.2, OIL: 1.2 }),
      config,
    );

    expect(quietCommodities.primaryRegime).toBe("fed_rates");
    expect(loudCommodities.primaryRegime).toBe("fed_rates");
    expect(loudCommodities.breadth.blocksScored).toBe(
      quietCommodities.breadth.blocksScored,
    );
    expect(loudCommodities.confidence.detail.exposureTotal).toBe(
      quietCommodities.confidence.detail.exposureTotal,
    );
    expect(
      loudCommodities.contributions.find((c) => c.symbol === "COPPER")!.weight,
    ).toBe(0);
  });
});

describe("coveragePenalty is the only missing-data charge on the score", () => {
  it("stale assets raise the penalty without shrinking breadth's denominator", () => {
    const fresh = classifyDriver(
      zInput({
        US2Y: -2,
        US10Y: -1.5,
        USD: -1.5,
        BTC: 1.2,
        GOLD: -1,
        VIX: -1,
        COPPER: 0.4,
        OIL: 0.3,
      }),
      config,
    );
    const stale = classifyDriver(
      zInput(
        {
          US2Y: -2,
          US10Y: -1.5,
          USD: -1.5,
          BTC: 1.2,
          GOLD: -1,
          VIX: -1,
          COPPER: 0.4,
          OIL: 0.3,
        },
        { stale: ["VIX"] },
      ),
      config,
    );

    expect(stale.confidence.coveragePenalty).toBeGreaterThan(
      fresh.confidence.coveragePenalty,
    );
    expect(stale.breadth.blocksScored).toBe(fresh.breadth.blocksScored);
  });
});

describe("risk vector cosine", () => {
  it("agrees with a hand-computed sign for a clear risk-on day", () => {
    const z = {
      BTC: 2,
      COPPER: 1.5,
      VIX: -2,
      USD: -1.5,
      GOLD: -1,
      US2Y: -1,
      US10Y: -0.8,
      OIL: 1,
    } as const;
    const result = classifyDriver(zInput({ ...z }), config);
    expect(result.riskDirection).toBe("risk_on");

    const symbols = Object.keys(z) as MacroSymbol[];
    const hand = cosine(
      symbols.map((s) => config.riskVector[s] ?? 0),
      symbols.map((s) => z[s]),
    );
    expect(hand).not.toBeNull();
    expect(hand!).toBeGreaterThan(0);
  });
});
