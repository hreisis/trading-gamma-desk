import { describe, expect, it } from "vitest";
import { MacroFeature } from "@/contracts";
import {
  DEFAULT_WINDOW_LENGTH,
  MAD_TO_SIGMA,
  US_MARKET_HOLIDAYS,
  buildMacroFeature,
  computeChange,
  defaultSessionCalendar,
  medianAbsoluteAboutZero,
  sigmaRawFromChanges,
  type DailyObservation,
} from "@/macro";

const TARGET = "2026-07-28";

/** Expected sessions ending at `TARGET`, newest last. */
function sessionsEndingAt(target: string, count: number): string[] {
  const dates = [target];
  let cursor = target;
  while (dates.length < count) {
    const previous = defaultSessionCalendar.previousSession(cursor);
    if (previous === null) throw new Error("calendar exhausted");
    dates.unshift(previous);
    cursor = previous;
  }
  return dates;
}

/**
 * Builds observations from a starting level and a list of per-session changes.
 * `changes[i]` moves the level into `sessions[i + 1]`.
 */
function priceSeries(
  sessions: readonly string[],
  start: number,
  changesPct: readonly number[],
): DailyObservation[] {
  const out: DailyObservation[] = [
    { sessionDate: sessions[0]!, value: start },
  ];
  let level = start;
  for (const [i, pct] of changesPct.entries()) {
    level *= 1 + pct / 100;
    out.push({ sessionDate: sessions[i + 1]!, value: level });
  }
  return out;
}

/** 22 sessions => 20 historical changes plus the current one. */
const SESSION_COUNT = DEFAULT_WINDOW_LENGTH + 2;
const SESSIONS = sessionsEndingAt(TARGET, SESSION_COUNT);

/** Alternating +/-0.5% history, then a -1.5% move on the scored session. */
const BASELINE_CHANGES = [
  ...Array.from({ length: DEFAULT_WINDOW_LENGTH }, (_, i) =>
    i % 2 === 0 ? 0.5 : -0.5,
  ),
  -1.5,
];

function baselineInput(overrides: Partial<Parameters<typeof buildMacroFeature>[0]> = {}) {
  return {
    symbol: "GOLD" as const,
    observations: priceSeries(SESSIONS, 100, BASELINE_CHANGES),
    targetSession: TARGET,
    ...overrides,
  };
}

describe("session calendar", () => {
  it("treats sessions either side of a holiday as adjacent", () => {
    // Reconciled against Treasury's published gaps: 3 July 2026 was a holiday.
    expect(defaultSessionCalendar.previousSession("2026-07-06")).toBe("2026-07-02");
    expect(defaultSessionCalendar.isSession("2026-07-03")).toBe(false);
  });

  it("matches every business-day gap observed in the Treasury file", () => {
    const observedGaps: [string, string][] = [
      ["2026-01-16", "2026-01-20"],
      ["2026-02-13", "2026-02-17"],
      ["2026-05-22", "2026-05-26"],
      ["2026-06-18", "2026-06-22"],
      ["2026-07-02", "2026-07-06"],
    ];
    for (const [before, after] of observedGaps) {
      expect(defaultSessionCalendar.previousSession(after)).toBe(before);
    }
  });

  it("skips weekends", () => {
    expect(defaultSessionCalendar.previousSession("2026-07-27")).toBe("2026-07-24");
    expect(defaultSessionCalendar.isSession("2026-07-25")).toBe(false);
  });

  it("keeps the holiday set non-empty for the years in use", () => {
    expect(US_MARKET_HOLIDAYS.has("2026-11-26")).toBe(true);
  });
});

describe("transforms keep their units and are not pre-rounded", () => {
  it("uses a simple return in percentage points for price assets", () => {
    expect(computeChange("simple_return", 100, 101)).toBeCloseTo(1, 12);
    // A log return would give 0.995..., which is not what the contract declares.
    expect(computeChange("simple_return", 100, 101)).not.toBeCloseTo(0.995, 3);
  });

  it("uses basis points for yields quoted in percent", () => {
    expect(computeChange("yield_diff", 4.3, 4.22)).toBeCloseTo(-8, 12);
  });

  it("does not round intermediate results", () => {
    const change = computeChange("simple_return", 3, 3.0000001);
    expect(change).not.toBe(0);
    expect(Math.abs(change)).toBeLessThan(1e-4);
  });
});

describe("sigma is a zero-centred MAD", () => {
  it("takes the median of absolute values, not of deviations from the median", () => {
    // Median-centred MAD of [1,1,1,5] is 0; about zero the median is 1.
    expect(medianAbsoluteAboutZero([1, 1, 1, 5])).toBe(1);
  });

  it("applies the normal consistency factor", () => {
    expect(sigmaRawFromChanges([-2, 2, -2, 2])).toBeCloseTo(MAD_TO_SIGMA * 2, 12);
  });
});

describe("window boundary", () => {
  it("produces a z-score with exactly 20 historical changes", () => {
    const feature = buildMacroFeature(baselineInput());
    expect(feature.window.validCount).toBe(20);
    expect(feature.zScore).not.toBeNull();
    expect(feature.flags).not.toContain("insufficientHistory");
    expect(MacroFeature.safeParse(feature).success).toBe(true);
  });

  it("refuses a z-score with only 19", () => {
    const sessions = sessionsEndingAt(TARGET, SESSION_COUNT - 1);
    const feature = buildMacroFeature({
      symbol: "GOLD",
      observations: priceSeries(sessions, 100, BASELINE_CHANGES.slice(1)),
      targetSession: TARGET,
    });
    expect(feature.window.validCount).toBe(19);
    expect(feature.zScore).toBeNull();
    expect(feature.flags).toContain("insufficientHistory");
    expect(feature.flags).toContain("volUnavailable");
    expect(MacroFeature.safeParse(feature).success).toBe(true);
  });

  it("never reaches into the scored session", () => {
    const feature = buildMacroFeature(baselineInput());
    expect(feature.window.endsAt).toBe(feature.currentFrom);
    expect(feature.window.sessionDates.at(-1)).toBe(feature.currentFrom);
    expect(
      feature.window.sessionDates.every((d) => d < feature.currentTo),
    ).toBe(true);
  });
});

describe("today cannot influence its own sigma", () => {
  it("leaves sigma unchanged when the scored move becomes extreme", () => {
    const calm = buildMacroFeature(baselineInput());
    const extreme = buildMacroFeature(
      baselineInput({
        observations: priceSeries(SESSIONS, 100, [
          ...BASELINE_CHANGES.slice(0, DEFAULT_WINDOW_LENGTH),
          -12,
        ]),
      }),
    );

    expect(extreme.sigmaRaw).toBe(calm.sigmaRaw);
    expect(extreme.sigmaUsed).toBe(calm.sigmaUsed);
    // Only the numerator moved, so the z-score must grow with the move.
    expect(Math.abs(extreme.zScore!)).toBeGreaterThan(Math.abs(calm.zScore!) * 3);
  });
});

describe("sign symmetry", () => {
  it("negates the z-score and leaves sigma alone when every change flips", () => {
    const positive = buildMacroFeature(baselineInput());
    const negated = buildMacroFeature(
      baselineInput({
        observations: priceSeries(
          SESSIONS,
          100,
          BASELINE_CHANGES.map((c) => -c),
        ),
      }),
    );

    expect(negated.sigmaRaw).toBeCloseTo(positive.sigmaRaw!, 9);
    expect(negated.currentChange!).toBeCloseTo(-positive.currentChange!, 9);
    expect(negated.zScore!).toBeCloseTo(-positive.zScore!, 6);
  });
});

describe("missing sessions are never bridged", () => {
  it("withholds the current change when t-1 is absent", () => {
    const observations = priceSeries(SESSIONS, 100, BASELINE_CHANGES).filter(
      (o) => o.sessionDate !== "2026-07-27",
    );
    const feature = buildMacroFeature(baselineInput({ observations }));

    expect(feature.consecutiveSessions).toBe(false);
    expect(feature.currentChange).toBeNull();
    expect(feature.zScore).toBeNull();
    expect(feature.flags).toContain("missingAdjacentSession");
    expect(MacroFeature.safeParse(feature).success).toBe(true);
  });

  it("drops the affected historical changes instead of spanning the gap", () => {
    const full = buildMacroFeature(baselineInput());
    const gapped = buildMacroFeature(
      baselineInput({
        observations: priceSeries(SESSIONS, 100, BASELINE_CHANGES).filter(
          (o) => o.sessionDate !== "2026-07-16",
        ),
      }),
    );

    // One absent session invalidates the two changes that touched it, and the
    // walk reaches one session further back rather than bridging.
    expect(gapped.window.validCount).toBeLessThan(full.window.validCount);
    expect(gapped.window.sessionDates).not.toContain("2026-07-16");
    expect(gapped.window.sessionDates).not.toContain("2026-07-17");
    expect(gapped.flags).toContain("insufficientHistory");
  });

  it("reports a missing scored session distinctly from a missing prior one", () => {
    const feature = buildMacroFeature(
      baselineInput({
        observations: priceSeries(SESSIONS, 100, BASELINE_CHANGES).filter(
          (o) => o.sessionDate !== TARGET,
        ),
      }),
    );
    expect(feature.flags).toContain("missing");
    expect(feature.flags).not.toContain("missingAdjacentSession");
    expect(feature.currentChange).toBeNull();
  });
});

describe("zero MAD is a data fault, not a quiet market", () => {
  it("returns no z-score and names both causes", () => {
    const flat = Array.from({ length: DEFAULT_WINDOW_LENGTH }, () => 0);
    const feature = buildMacroFeature(
      baselineInput({
        observations: priceSeries(SESSIONS, 100, [...flat, -1.5]),
        sigmaFloor: 0.25,
      }),
    );

    expect(feature.sigmaRaw).toBe(0);
    expect(feature.zScore).toBeNull();
    expect(feature.flags).toContain("repeatedPrints");
    expect(feature.flags).toContain("volUnavailable");
    // The floor must not rescue a zero scale.
    expect(feature.sigmaFloorApplied).toBe(false);
    expect(feature.sigmaUsed).toBe(0);
    expect(MacroFeature.safeParse(feature).success).toBe(true);
  });

  it("still reports zero when a bare majority of the window is identical", () => {
    const changes = Array.from({ length: DEFAULT_WINDOW_LENGTH }, (_, i) =>
      i < 11 ? 0 : 0.8,
    );
    const feature = buildMacroFeature(
      baselineInput({ observations: priceSeries(SESSIONS, 100, [...changes, -1.5]) }),
    );
    expect(feature.sigmaRaw).toBe(0);
    expect(feature.flags).toContain("repeatedPrints");
  });
});

describe("sigma floor boundary", () => {
  const quiet = Array.from({ length: DEFAULT_WINDOW_LENGTH }, (_, i) =>
    i % 2 === 0 ? 0.1 : -0.1,
  );

  function withFloor(floor: number) {
    return buildMacroFeature(
      baselineInput({
        observations: priceSeries(SESSIONS, 100, [...quiet, -1.5]),
        sigmaFloor: floor,
      }),
    );
  }

  it("applies the floor strictly below it", () => {
    const bare = withFloor(0);
    const sigmaRaw = bare.sigmaRaw!;
    const floored = withFloor(sigmaRaw * 2);

    expect(floored.sigmaFloorApplied).toBe(true);
    expect(floored.sigmaUsed).toBeCloseTo(sigmaRaw * 2, 12);
    expect(floored.flags).toContain("sigmaFloorApplied");
    // Flooring can only shrink the z-score, never inflate it.
    expect(Math.abs(floored.zScore!)).toBeLessThan(Math.abs(bare.zScore!));
  });

  it("leaves sigma untouched exactly at the floor", () => {
    const sigmaRaw = withFloor(0).sigmaRaw!;
    const atFloor = withFloor(sigmaRaw);

    expect(atFloor.sigmaFloorApplied).toBe(false);
    expect(atFloor.sigmaUsed).toBe(sigmaRaw);
    expect(atFloor.flags).not.toContain("sigmaFloorApplied");
  });

  it("leaves sigma untouched above the floor", () => {
    const sigmaRaw = withFloor(0).sigmaRaw!;
    const belowFloor = withFloor(sigmaRaw / 2);
    expect(belowFloor.sigmaFloorApplied).toBe(false);
    expect(belowFloor.sigmaUsed).toBe(sigmaRaw);
  });
});

describe("invalid observations", () => {
  it("rejects a non-positive price", () => {
    const observations = priceSeries(SESSIONS, 100, BASELINE_CHANGES).map((o) =>
      o.sessionDate === TARGET ? { ...o, value: 0 } : o,
    );
    const feature = buildMacroFeature(baselineInput({ observations }));

    expect(feature.flags).toContain("invalidPrice");
    expect(feature.currentChange).toBeNull();
    expect(feature.zScore).toBeNull();
    expect(MacroFeature.safeParse(feature).success).toBe(true);
  });

  it("rejects a non-finite price", () => {
    const observations = priceSeries(SESSIONS, 100, BASELINE_CHANGES).map((o) =>
      o.sessionDate === "2026-07-27" ? { ...o, value: Number.NaN } : o,
    );
    const feature = buildMacroFeature(baselineInput({ observations }));

    expect(feature.flags).toContain("invalidPrice");
    expect(feature.flags).toContain("missingAdjacentSession");
    expect(feature.currentChange).toBeNull();
  });

  it("accepts a zero or negative yield, which is legitimate", () => {
    const sessions = SESSIONS;
    const observations = sessions.map((sessionDate, i) => ({
      sessionDate,
      value: i % 2 === 0 ? 0 : -0.05,
    }));
    const feature = buildMacroFeature({
      symbol: "US2Y",
      observations,
      targetSession: TARGET,
    });

    expect(feature.flags).not.toContain("invalidPrice");
    expect(feature.unit).toBe("bps");
    expect(feature.currentChange).not.toBeNull();
  });

  it("rejects a target that is not an expected session", () => {
    expect(() =>
      buildMacroFeature(baselineInput({ targetSession: "2026-07-03" })),
    ).toThrow(/not an expected session/);
  });
});

describe("every produced feature satisfies the contract", () => {
  it("validates across the failure modes", () => {
    const variants = [
      baselineInput(),
      baselineInput({ windowLength: 5 }),
      baselineInput({
        observations: priceSeries(SESSIONS, 100, BASELINE_CHANGES).slice(3),
      }),
      baselineInput({ symbol: "US2Y" }),
    ];
    for (const variant of variants) {
      const result = MacroFeature.safeParse(buildMacroFeature(variant));
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });
});
