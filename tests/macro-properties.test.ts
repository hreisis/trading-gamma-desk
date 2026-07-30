import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SYMBOLS,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "@/contracts";
import {
  classifyDriver,
  computeStrength,
  observedZ,
  type ScoreInput,
} from "@/macro";

/**
 * M1-5 property tests. These lock the mathematical claims in the contracts
 * rather than any one scenario's numbers: sign flip, positive scaling of an
 * unsaturated day, input-order invariance, and the rates-block confirmation
 * cap that defeats a single-yield confidence inflation.
 */

const config = RegimeSignatureConfig.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/macro/regime-signature.sig-2026-07-01.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

function zInput(
  values: Readonly<Record<MacroSymbol, number | null>>,
): ScoreInput[] {
  return ALL_SYMBOLS.map((symbol) => ({
    symbol,
    zScore: values[symbol],
  }));
}

function bySymbol(inputs: readonly ScoreInput[]): Map<MacroSymbol, number | null> {
  return new Map(inputs.map((i) => [i.symbol, i.zScore]));
}

/**
 * Rates-led easing with enough separation from liquidity to stay out of
 * mixed_unresolved, and with rms low enough that strength stays below 1
 * both before and after a 1.6× scale — required for the scaling property.
 */
const EASING: Record<MacroSymbol, number> = {
  US2Y: -1.5,
  US10Y: -1.1,
  USD: -1.3,
  BTC: 1.0,
  GOLD: 0.2,
  VIX: -0.25,
  COPPER: 0.25,
  OIL: 0.15,
};

function flip(values: Readonly<Record<MacroSymbol, number>>): Record<MacroSymbol, number> {
  return Object.fromEntries(
    ALL_SYMBOLS.map((s) => [s, -values[s]]),
  ) as Record<MacroSymbol, number>;
}

function scale(
  values: Readonly<Record<MacroSymbol, number>>,
  k: number,
): Record<MacroSymbol, number> {
  return Object.fromEntries(
    ALL_SYMBOLS.map((s) => [s, values[s] * k]),
  ) as Record<MacroSymbol, number>;
}

function component(
  result: ReturnType<typeof classifyDriver>,
  name: string,
): number {
  return result.confidence.components.find((c) => c.name === name)!.value;
}

describe("sign-flip: z → −z", () => {
  const base = classifyDriver(zInput(EASING), config);
  const flipped = classifyDriver(zInput(flip(EASING)), config);

  it("leaves |score| and the winning regime family unchanged", () => {
    expect(base.primaryRegime).toBe(flipped.primaryRegime);
    expect(Math.abs(base.confidence.detail.scoreTop)).toBeCloseTo(
      Math.abs(flipped.confidence.detail.scoreTop),
      9,
    );
    if (base.confidence.detail.scoreSecond !== null) {
      expect(Math.abs(base.confidence.detail.scoreSecond)).toBeCloseTo(
        Math.abs(flipped.confidence.detail.scoreSecond!),
        9,
      );
    }
  });

  it("flips polarity and risk direction, not confirming membership", () => {
    expect(base.polarity).not.toBeNull();
    expect(flipped.polarity).toBe(
      base.polarity === "positive" ? "negative" : "positive",
    );

    if (base.riskDirection === "risk_on") {
      expect(flipped.riskDirection).toBe("risk_off");
    } else if (base.riskDirection === "risk_off") {
      expect(flipped.riskDirection).toBe("risk_on");
    } else {
      expect(flipped.riskDirection).toBe(base.riskDirection);
    }

    for (const symbol of ALL_SYMBOLS) {
      const a = base.contributions.find((c) => c.symbol === symbol)!;
      const b = flipped.contributions.find((c) => c.symbol === symbol)!;
      // Roles are defined by sign(w·z) against sign(s). Both flip, so the
      // relative membership is invariant — confirming does NOT become
      // contradicting under a global sign flip.
      expect(b.role).toBe(a.role);
      expect(b.contribution).toBeCloseTo(-a.contribution, 9);
    }
  });

  it("leaves every confidence component and the aggregate score unchanged", () => {
    for (const name of [
      "patternMatch",
      "distinctiveness",
      "coherence",
      "effectiveBreadth",
      "strength",
    ] as const) {
      expect(component(flipped, name)).toBeCloseTo(component(base, name), 9);
    }
    expect(flipped.confidence.score).toBe(base.confidence.score);
    expect(flipped.breadth.effectiveConfirmations).toBeCloseTo(
      base.breadth.effectiveConfirmations,
      9,
    );
  });
});

describe("positive scaling on an unsaturated fixture", () => {
  // Cosine is scale-invariant, so patternMatch and distinctiveness stay put.
  // strength = min(1, rms(z)/2) is the component that must move — which is
  // why the fixture has to sit below the strength ceiling both before and
  // after the scale. A saturated day would make this test pass vacuously.
  const k = 1.6;
  const beforeZ = EASING;
  const afterZ = scale(EASING, k);

  const strengthBefore = computeStrength(observedZ(zInput(beforeZ)));
  const strengthAfter = computeStrength(observedZ(zInput(afterZ)));

  it("uses a fixture that does not saturate strength either side of the scale", () => {
    expect(strengthBefore).toBeGreaterThan(0);
    expect(strengthBefore).toBeLessThan(1);
    expect(strengthAfter).toBeGreaterThan(strengthBefore);
    expect(strengthAfter).toBeLessThan(1);
  });

  it("leaves cosine-derived components unchanged and moves strength", () => {
    const before = classifyDriver(zInput(beforeZ), config);
    const after = classifyDriver(zInput(afterZ), config);

    expect(after.primaryRegime).toBe(before.primaryRegime);
    expect(after.polarity).toBe(before.polarity);
    expect(component(after, "patternMatch")).toBeCloseTo(
      component(before, "patternMatch"),
      9,
    );
    expect(component(after, "distinctiveness")).toBeCloseTo(
      component(before, "distinctiveness"),
      9,
    );
    expect(component(after, "coherence")).toBeCloseTo(
      component(before, "coherence"),
      9,
    );
    expect(component(after, "effectiveBreadth")).toBeCloseTo(
      component(before, "effectiveBreadth"),
      9,
    );
    expect(component(after, "strength")).toBeCloseTo(strengthAfter, 9);
    expect(component(after, "strength")).toBeGreaterThan(
      component(before, "strength"),
    );
  });

  it("raises the confidence score when strength is the only moving part", () => {
    const before = classifyDriver(zInput(beforeZ), config);
    const after = classifyDriver(zInput(afterZ), config);

    // Neither side may be pinned by a hard cap or a zero gate, or the
    // score comparison would not speak to the aggregation itself.
    expect(before.confidence.zeroedBy).toBeNull();
    expect(after.confidence.zeroedBy).toBeNull();
    expect(before.confidence.score).toBeGreaterThan(0);
    expect(after.confidence.score).toBeGreaterThan(before.confidence.score);
  });
});

describe("permutation invariance", () => {
  it("does not depend on the order of the input array", () => {
    const baseInputs = zInput(EASING);
    const reversed = [...baseInputs].reverse();
    const rotated = [
      ...baseInputs.slice(3),
      ...baseInputs.slice(0, 3),
    ];

    const base = classifyDriver(baseInputs, config);
    for (const ordered of [reversed, rotated]) {
      const result = classifyDriver(ordered, config);
      expect(result.primaryRegime).toBe(base.primaryRegime);
      expect(result.polarity).toBe(base.polarity);
      expect(result.riskDirection).toBe(base.riskDirection);
      expect(result.confidence.score).toBe(base.confidence.score);
      expect(result.confidence.detail.scoreTop).toBeCloseTo(
        base.confidence.detail.scoreTop,
        12,
      );

      for (const symbol of ALL_SYMBOLS) {
        const a = base.contributions.find((c) => c.symbol === symbol)!;
        const b = result.contributions.find((c) => c.symbol === symbol)!;
        expect(b.role).toBe(a.role);
        expect(b.contribution).toBeCloseTo(a.contribution, 12);
      }
    }
  });

  it("still agrees after a Fisher–Yates shuffle of a copy", () => {
    // Deterministic shuffle so the property is reproducible in CI.
    const inputs = zInput(EASING);
    const shuffled = [...inputs];
    let seed = 0xc0ffee;
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    expect(bySymbol(shuffled)).toEqual(bySymbol(inputs));
    expect(shuffled.map((i) => i.symbol)).not.toEqual(
      inputs.map((i) => i.symbol),
    );

    const base = classifyDriver(inputs, config);
    const result = classifyDriver(shuffled, config);
    expect(result.confidence.score).toBe(base.confidence.score);
    expect(result.primaryRegime).toBe(base.primaryRegime);
  });
});

describe("correlated rates block cannot mint two confirmations", () => {
  it("keeps effectiveConfirmations ≤ 1 for a rates-only move", () => {
    // Both yields confirm the same easing pattern. Counting assets would
    // report 2; the block cap must report at most 1, which is what keeps a
    // violent 2Y day from clearing the high-confidence gate alone.
    const ratesOnly = zInput({
      US2Y: -3.5,
      US10Y: -2.8,
      GOLD: 0.05,
      COPPER: 0.05,
      OIL: 0.05,
      USD: 0.05,
      VIX: 0.05,
      BTC: 0.05,
    });

    const result = classifyDriver(ratesOnly, config);
    const ratesRoles = result.contributions.filter(
      (c) => c.symbol === "US2Y" || c.symbol === "US10Y",
    );

    expect(ratesRoles.every((c) => c.role === "confirming")).toBe(true);
    expect(result.breadth.effectiveConfirmations).toBeLessThanOrEqual(1);
    expect(result.confidence.score).toBeLessThanOrEqual(69);
  });

  it("still caps at 1 when the rest of the book mildly confirms the same way", () => {
    // USD and BTC also lean the fed_rates easing way, each in their own
    // block — those are allowed to add independent confirmations. The
    // rates block itself must still contribute ≤ 1.
    const result = classifyDriver(
      zInput({
        US2Y: -2.5,
        US10Y: -2.0,
        USD: -1.5,
        BTC: 1.2,
        GOLD: 0.1,
        VIX: 0.1,
        COPPER: 0.1,
        OIL: 0.1,
      }),
      config,
    );

    const ratesConfirmRatio =
      // Reconstruct the rates block's contribution to the sum: with two
      // confirming observed members the block's confirmRatio is 1.
      result.contributions.filter(
        (c) =>
          (c.symbol === "US2Y" || c.symbol === "US10Y") &&
          c.role === "confirming",
      ).length === 2
        ? 1
        : 0;

    expect(ratesConfirmRatio).toBe(1);
    // Total effective confirmations may exceed 1 because usd/crypto join,
    // but the rates pair alone must not have counted as two.
    expect(result.breadth.effectiveConfirmations).toBeGreaterThan(1);
    expect(result.breadth.effectiveConfirmations).toBeLessThan(4);
  });
});
