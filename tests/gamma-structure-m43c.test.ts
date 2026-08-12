import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOUNDED_GAMMA_SCOPE,
  BoundedGammaProviderSnapshot,
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
  MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION,
  MarketStructureStateV2,
  type BoundedGammaProviderSnapshot as BoundedDto,
  type GammaChangeSet as GammaChangeSetDto,
  type GammaChangeMetrics,
} from "@/contracts";
import {
  buildMarketStructureStateV2,
  deriveStructureCondition,
} from "@/gamma";

const FIXTURE = join(
  process.cwd(),
  "fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json",
);

function loadBounded(): BoundedDto {
  return BoundedGammaProviderSnapshot.parse(
    JSON.parse(readFileSync(FIXTURE, "utf8")),
  );
}

function withBounded(overrides: Partial<BoundedDto> = {}): BoundedDto {
  const base = loadBounded();
  return BoundedGammaProviderSnapshot.parse({
    ...base,
    ...overrides,
    source: overrides.source ?? base.source,
    strikeRequest: overrides.strikeRequest ?? base.strikeRequest,
    strikeReturned: overrides.strikeReturned ?? base.strikeReturned,
    zeroDte: overrides.zeroDte ?? base.zeroDte,
    boundedCallWall: overrides.boundedCallWall ?? base.boundedCallWall,
    boundedPutWall: overrides.boundedPutWall ?? base.boundedPutWall,
    gammaFlip: overrides.gammaFlip ?? base.gammaFlip,
    coverage: overrides.coverage ?? base.coverage,
    byStrike: overrides.byStrike ?? base.byStrike,
    byExpiry: overrides.byExpiry ?? base.byExpiry,
    limitations: overrides.limitations ?? base.limitations,
    credits: overrides.credits ?? base.credits,
  });
}

function metrics(partial?: Partial<GammaChangeMetrics>): GammaChangeMetrics {
  return {
    spot: {
      status: "available",
      current: 741.63,
      baseline: 740,
      absoluteChange: 1.63,
      pctChange: { status: "available", value: 0.2202702702702703 },
    },
    totalGex: {
      status: "available",
      current: -4e9,
      baseline: -3e9,
      absoluteChange: -1e9,
      pctChange: { status: "available", value: -33.333333333333336 },
    },
    gammaRegime: {
      status: "available",
      current: "negative",
      baseline: "negative",
      changed: false,
    },
    callWall: {
      status: "available",
      currentStrike: 745,
      baselineStrike: 744,
      absoluteChange: 1,
      pctChange: { status: "available", value: 0.13440860215053763 },
    },
    putWall: {
      status: "available",
      currentStrike: 743,
      baselineStrike: 742,
      absoluteChange: 1,
      pctChange: { status: "available", value: 0.13477088948787062 },
    },
    zeroDteShareOfGrossGex: {
      status: "unavailable",
      reason: "zeroDte share unavailable in baseline or current",
    },
    ...partial,
  };
}

function changeSet(
  overrides: Partial<GammaChangeSetDto> = {},
): GammaChangeSetDto {
  const base = loadBounded();
  return {
    kind: "GammaChangeSet",
    schemaVersion: "0.1.1",
    currentSnapshotId: `${base.symbol}|${base.sessionDate}|intraday|${base.vendorAsOf}`,
    underlying: base.symbol,
    sessionDate: base.sessionDate,
    asOf: base.vendorAsOf,
    captureKind: "intraday",
    methodologyId: GEX_METHODOLOGY_ID,
    methodologyVersion: GEX_METHODOLOGY_VERSION,
    versusPriorClose: {
      baseline: {
        status: "available",
        snapshotId: `${base.symbol}|2026-07-29|close|2026-07-29T20:00:00.000Z`,
        sessionDate: "2026-07-29",
        captureKind: "close",
        asOf: "2026-07-29T20:00:00.000Z",
      },
      metrics: metrics(),
    },
    versusSessionOpen: {
      baseline: {
        status: "available",
        snapshotId: `${base.symbol}|${base.sessionDate}|open|2026-07-30T13:30:00.000Z`,
        sessionDate: base.sessionDate,
        captureKind: "open",
        asOf: "2026-07-30T13:30:00.000Z",
      },
      metrics: metrics({
        totalGex: {
          status: "available",
          current: -4e9,
          baseline: -3.5e9,
          absoluteChange: -5e8,
          pctChange: { status: "available", value: -14.285714285714286 },
        },
      }),
    },
    ...overrides,
  };
}

describe("M4-3C MarketStructureState v0.2.0 condition taxonomy", () => {
  it("maps regimes and availability to condition states", () => {
    expect(
      deriveStructureCondition({
        availability: "available",
        regime: "positive",
      }),
    ).toBe("positive_gamma_stabilizing");
    expect(
      deriveStructureCondition({
        availability: "available",
        regime: "negative",
      }),
    ).toBe("negative_gamma_amplifying");
    expect(
      deriveStructureCondition({
        availability: "available",
        regime: "near_zero",
      }),
    ).toBe("near_zero_transition");
    expect(
      deriveStructureCondition({
        availability: "incomplete",
        regime: "negative",
      }),
    ).toBe("incomplete_structure");
    expect(
      deriveStructureCondition({
        availability: "partial",
        regime: "positive",
      }),
    ).toBe("incomplete_structure");
    expect(
      deriveStructureCondition({
        availability: "unavailable",
        regime: "positive",
      }),
    ).toBe("unavailable");
    expect(
      deriveStructureCondition({
        availability: "available",
        regime: "unavailable",
      }),
    ).toBe("unavailable");
  });

  it("builds positive / negative / near_zero / unavailable states", () => {
    const positive = buildMarketStructureStateV2({
      bounded: withBounded({
        status: "available",
        gammaRegime: "positive",
        totalGex: 1e9,
        coverage: {
          contractsIn: 100,
          contractsUsed: 100,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
          usableGammaCoveragePct: 100,
        },
        limitations: ["BOUNDED single-expiry sample"],
      }),
    });
    expect(positive.condition).toBe("positive_gamma_stabilizing");
    expect(positive.interpretation.summary).toMatch(/stabilizing/i);

    const negative = buildMarketStructureStateV2({
      bounded: withBounded({
        status: "available",
        gammaRegime: "negative",
        totalGex: -1e9,
        coverage: {
          contractsIn: 100,
          contractsUsed: 100,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
          usableGammaCoveragePct: 100,
        },
        limitations: ["BOUNDED single-expiry sample"],
      }),
    });
    expect(negative.condition).toBe("negative_gamma_amplifying");
    expect(negative.interpretation.summary).toMatch(/amplify/i);

    const nearZero = buildMarketStructureStateV2({
      bounded: withBounded({
        status: "available",
        gammaRegime: "near_zero",
        totalGex: 1,
        coverage: {
          contractsIn: 100,
          contractsUsed: 100,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
          usableGammaCoveragePct: 100,
        },
        limitations: ["BOUNDED single-expiry sample"],
      }),
    });
    expect(nearZero.condition).toBe("near_zero_transition");

    const unavailable = buildMarketStructureStateV2({
      bounded: withBounded({
        status: "unavailable",
        gammaRegime: "unavailable",
        totalGex: null,
        spot: null,
        coverage: {
          contractsIn: 0,
          contractsUsed: 0,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
        },
        boundedCallWall: {
          status: "unavailable",
          reason: "no usable call GEX",
          scope: BOUNDED_GAMMA_SCOPE,
        },
        boundedPutWall: {
          status: "unavailable",
          reason: "no usable put GEX",
          scope: BOUNDED_GAMMA_SCOPE,
        },
        limitations: ["no usable contracts"],
        gammaFlip: {
          status: "unavailable",
          reason: "Gamma Flip unavailable — no usable contracts in bounded aggregate",
          scope: BOUNDED_GAMMA_SCOPE,
        },
      }),
    });
    expect(unavailable.condition).toBe("unavailable");
    expect(unavailable.flip.status).toBe("unavailable");
  });
});

describe("M4-3C bounded fixture + incomplete coverage", () => {
  it("accepts spy-bounded-ui fixture and keeps incomplete_structure", () => {
    const state = buildMarketStructureStateV2({ bounded: loadBounded() });
    expect(MarketStructureStateV2.safeParse(state).success).toBe(true);
    expect(state.schemaVersion).toBe(MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION);
    expect(state.scope).toBe(BOUNDED_GAMMA_SCOPE);
    expect(state.condition).toBe("incomplete_structure");
    expect(state.regime).toBe("negative");
    expect(state.boundedCallWall.scope).toBe(BOUNDED_GAMMA_SCOPE);
    expect(state.boundedPutWall.scope).toBe(BOUNDED_GAMMA_SCOPE);
    expect(state.boundedCallWall.strike).toBe(745);
    expect(state.boundedPutWall.strike).toBe(743);
    expect(state.interpretation.summary).toMatch(/degraded/i);
    expect(state.interpretation.summary + state.interpretation.bullets.join(" ")).toMatch(
      /bounded/i,
    );
  });

  it("never relabels bounded walls as market walls", () => {
    const state = buildMarketStructureStateV2({ bounded: loadBounded() });
    const text = [
      state.interpretation.summary,
      ...state.interpretation.bullets,
      ...state.limitations,
      ...state.evidence.map((e) => `${e.statement} ${e.basis}`),
    ]
      .join("\n")
      .toLowerCase();
    expect(text).not.toMatch(/market call wall/);
    expect(text).not.toMatch(/market put wall/);
    expect(state.boundedCallWall.scope).toBe("bounded_single_expiry");
    expect(state.boundedPutWall.scope).toBe("bounded_single_expiry");
  });

  it("passes through persisted bounded gamma flip", () => {
    const state = buildMarketStructureStateV2({ bounded: loadBounded() });
    expect(state.flip.status).toBe("available");
    if (state.flip.status !== "available") return;
    expect(state.flip.strike).toBe(745.9);
    expect(state.flip.method).toBe("spot_shock_bs_gamma");
    expect(state.flip.level).toBe(745.9);
  });
});

describe("M4-3C change context", () => {
  it("marks change context unavailable when change set missing", () => {
    const state = buildMarketStructureStateV2({ bounded: loadBounded() });
    expect(state.changeContext).toEqual({
      status: "unavailable",
      reason: expect.stringMatching(/No compatible GammaChangeSet/i),
    });
    expect(state.evidence.some((e) => e.id === "change_context")).toBe(true);
  });

  it("includes prior-close and session-open when change set is compatible", () => {
    const state = buildMarketStructureStateV2({
      bounded: loadBounded(),
      changeSet: changeSet(),
    });
    expect(state.changeContext.status).toBe("available");
    if (state.changeContext.status !== "available") {
      throw new Error("expected available change context");
    }
    expect(state.changeContext.versusPriorClose.totalGexDirection).toEqual({
      status: "available",
      direction: "lower",
    });
    expect(state.changeContext.versusSessionOpen.metrics.totalGex).toMatchObject(
      {
        status: "available",
        absoluteChange: -5e8,
      },
    );
    expect(state.evidence.some((e) => e.id === "change_prior_close")).toBe(
      true,
    );
    expect(state.evidence.some((e) => e.id === "change_session_open")).toBe(
      true,
    );
  });

  it("rejects mismatched symbol / session / methodology as unavailable", () => {
    const wrongSymbol = buildMarketStructureStateV2({
      bounded: loadBounded(),
      changeSet: changeSet({ underlying: "SPX" }),
    });
    expect(wrongSymbol.changeContext.status).toBe("unavailable");
    if (wrongSymbol.changeContext.status === "unavailable") {
      expect(wrongSymbol.changeContext.reason).toMatch(/underlying/i);
    }

    const wrongSession = buildMarketStructureStateV2({
      bounded: loadBounded(),
      changeSet: changeSet({ sessionDate: "2026-07-01" }),
    });
    expect(wrongSession.changeContext.status).toBe("unavailable");
    if (wrongSession.changeContext.status === "unavailable") {
      expect(wrongSession.changeContext.reason).toMatch(/sessionDate/i);
    }
  });
});

describe("M4-3C interpretation guardrails + determinism", () => {
  it("avoids directional / predictive / flow language", () => {
    const variants = [
      withBounded({
        status: "available",
        gammaRegime: "positive",
        coverage: {
          contractsIn: 10,
          contractsUsed: 10,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
        },
        limitations: ["BOUNDED"],
      }),
      withBounded({
        status: "available",
        gammaRegime: "negative",
        coverage: {
          contractsIn: 10,
          contractsUsed: 10,
          contractsSkipped: 0,
          skipReasons: {},
          suspectVendorGreeksCount: 0,
        },
        limitations: ["BOUNDED"],
      }),
      loadBounded(),
    ];
    for (const bounded of variants) {
      const state = buildMarketStructureStateV2({ bounded });
      const text = [
        state.interpretation.summary,
        ...state.interpretation.bullets,
      ]
        .join("\n")
        .toLowerCase();
      expect(text).not.toMatch(/\bbuy\b/);
      expect(text).not.toMatch(/\bsell\b/);
      expect(text).not.toMatch(/\bbullish\b/);
      expect(text).not.toMatch(/\bbearish\b/);
      expect(text).not.toMatch(/money is flowing/);
      expect(text).not.toMatch(/market call wall/);
      expect(text).not.toMatch(/market put wall/);
    }
  });

  it("is deterministic for identical inputs", () => {
    const bounded = loadBounded();
    const cs = changeSet();
    const a = buildMarketStructureStateV2({
      bounded,
      changeSet: cs,
      generatedAt: "2026-07-30T20:05:00.000Z",
    });
    const b = buildMarketStructureStateV2({
      bounded,
      changeSet: cs,
      generatedAt: "2026-07-30T20:05:00.000Z",
    });
    expect(a).toEqual(b);
  });

  it("preserves evidence ids for GEX, walls, DTE, coverage, suspects", () => {
    const state = buildMarketStructureStateV2({ bounded: loadBounded() });
    const ids = state.evidence.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "total_gex",
        "gross_gex",
        "spot_vs_bounded_call_wall",
        "spot_vs_bounded_put_wall",
        "dte",
        "usable_gamma_coverage",
        "suspect_vendor_greeks",
        "scope_strike_range",
        "change_context",
      ]),
    );
  });
});
