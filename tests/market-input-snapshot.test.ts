import { describe, expect, it } from "vitest";
import {
  buildMarketInputSnapshot,
  loadBoundedGammaDeskView,
  type MacroDeskView,
} from "@/desk";
import {
  deriveMarketInputSnapshotSummary,
  MarketInputField,
  MarketInputFieldStatus,
  MarketInputKey,
  MarketInputSnapshot,
  MARKET_INPUT_KEY_COUNT,
  statusCountTotal,
} from "@/contracts";
import fixtureDriver from "../fixtures/macro/dominant-driver.rates-led-easing.json";

const REQUIRED_FIELD_KEYS = [
  "value",
  "asOf",
  "marketSessionDate",
  "source",
  "status",
  "stale",
  "missingReason",
  "isProxy",
] as const;

function baseSnapshotInput(overrides: {
  targetMarketSessionDate?: string;
  macro?: MacroDeskView | null;
} = {}) {
  return {
    targetMarketSessionDate: overrides.targetMarketSessionDate ?? "2026-07-28",
    generatedAt: "2026-07-29T12:00:00-04:00",
    macro: overrides.macro ?? null,
    alpacaPanel: null,
    catalystFeed: null,
    spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
    qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
    publicDemo: false,
  };
}

function field(
  snapshot: ReturnType<typeof buildMarketInputSnapshot>,
  key: string,
) {
  const row = snapshot.inputs.find((input) => input.key === key);
  if (!row) throw new Error(`missing field ${key}`);
  return row;
}

function readyMacroView(): MacroDeskView {
  return {
    status: "ready",
    source: "fixture",
    sourceLabel: "fixture",
    isDemo: false,
    isPublicDemo: false,
    isLiveDriver: false,
    driver: fixtureDriver as MacroDeskView["driver"],
    driverPath: "fixtures/macro/dominant-driver.rates-led-easing.json",
    snapshotPresent: true,
    snapshotPath: "fixtures/macro/snapshot.json",
    sessionStale: false,
    pipeline: null,
    error: null,
  };
}

describe("MarketInputSnapshot contract", () => {
  it("parses a complete snapshot envelope", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-28",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: readyMacroView(),
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    expect(() => MarketInputSnapshot.parse(snapshot)).not.toThrow();
    expect(snapshot.kind).toBe("MarketInputSnapshot");
    expect(snapshot.inputs).toHaveLength(14);
  });
});

describe("MarketInputSnapshot invariants", () => {
  it("contains all 14 keys exactly once with status counts summing to inputs.length", () => {
    const snapshot = buildMarketInputSnapshot(baseSnapshotInput());

    expect(snapshot.inputs).toHaveLength(MARKET_INPUT_KEY_COUNT);
    expect(MarketInputKey.options).toHaveLength(MARKET_INPUT_KEY_COUNT);

    const keys = snapshot.inputs.map((row) => row.key);
    expect(new Set(keys).size).toBe(MARKET_INPUT_KEY_COUNT);
    expect([...keys].sort()).toEqual([...MarketInputKey.options].sort());

    const statusTotal = statusCountTotal(snapshot.summary);
    expect(statusTotal).toBe(snapshot.inputs.length);
    expect(statusTotal).toBe(MARKET_INPUT_KEY_COUNT);
  });

  it("assigns exactly one primary status per input", () => {
    const snapshot = buildMarketInputSnapshot(baseSnapshotInput());
    const allowed = new Set(MarketInputFieldStatus.options);

    for (const row of snapshot.inputs) {
      expect(allowed.has(row.status)).toBe(true);
      const matches = [
        row.status === "available",
        row.status === "partial",
        row.status === "incomplete",
        row.status === "unavailable",
        row.status === "missing",
      ].filter(Boolean);
      expect(matches).toHaveLength(1);
    }
  });

  it("computes staleCount and crossSessionCount independently of status buckets", () => {
    const snapshot = buildMarketInputSnapshot(
      baseSnapshotInput({
        targetMarketSessionDate: "2026-08-06",
        macro: readyMacroView(),
      }),
    );

    const staleRows = snapshot.inputs.filter((row) => row.stale);
    const crossRows = snapshot.inputs.filter(
      (row) =>
        row.marketSessionDate !== null &&
        row.marketSessionDate !== snapshot.targetMarketSessionDate,
    );

    expect(snapshot.summary.staleCount).toBe(staleRows.length);
    expect(snapshot.summary.crossSessionCount).toBe(crossRows.length);
    expect(snapshot.summary.staleCount).toBeGreaterThan(0);
    expect(snapshot.summary.crossSessionCount).toBeGreaterThan(0);
    expect(statusCountTotal(snapshot.summary)).toBe(MARKET_INPUT_KEY_COUNT);
  });

  it("rejects hand-maintained summary that diverges from inputs", () => {
    const snapshot = buildMarketInputSnapshot(baseSnapshotInput());
    const tampered = {
      ...snapshot,
      summary: { ...snapshot.summary, missingCount: snapshot.summary.missingCount + 1 },
    };

    expect(() => MarketInputSnapshot.parse(tampered)).toThrow(/derived from inputs|must equal inputs.length/);
  });

  it("derives summary only via deriveMarketInputSnapshotSummary", () => {
    const snapshot = buildMarketInputSnapshot(baseSnapshotInput());
    const derived = deriveMarketInputSnapshotSummary(
      snapshot.inputs,
      snapshot.targetMarketSessionDate,
    );

    expect(derived.summary).toEqual(snapshot.summary);
    expect(derived.sessionAlignment).toBe(snapshot.sessionAlignment);
    expect(derived.isCompleteCrossSection).toBe(snapshot.isCompleteCrossSection);
  });

  it("materializes explicit nulls on every required field key", () => {
    const snapshot = buildMarketInputSnapshot(baseSnapshotInput());

    for (const row of snapshot.inputs) {
      const keys = Object.keys(row);
      for (const required of REQUIRED_FIELD_KEYS) {
        expect(keys).toContain(required);
      }
      expect(row.source).toMatchObject({
        provider: expect.any(String),
        artifact: expect.any(String),
        fetchedAt: row.source.fetchedAt === null ? null : expect.any(String),
      });
      if (row.missingReason === null) {
        expect(row.missingReason).toBeNull();
      }
      if (row.asOf === null) {
        expect(row.asOf).toBeNull();
      }
      if (row.marketSessionDate === null) {
        expect(row.marketSessionDate).toBeNull();
      }
      if (row.value === null) {
        expect(row.value).toBeNull();
      }
    }
  });

  it("reports cross-session fixture summary that sums to 14 (not 13)", () => {
    const snapshot = buildMarketInputSnapshot(
      baseSnapshotInput({
        targetMarketSessionDate: "2026-08-06",
        macro: readyMacroView(),
      }),
    );

    expect(statusCountTotal(snapshot.summary)).toBe(14);
    expect(snapshot.summary).toMatchObject({
      availableCount: 0,
      partialCount: 4,
      incompleteCount: 1,
      unavailableCount: 6,
      missingCount: 3,
      staleCount: expect.any(Number),
      crossSessionCount: expect.any(Number),
    });
  });
});

describe("buildMarketInputSnapshot", () => {
  it("marks unwired session inputs as missing without proxy substitution", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-28",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    expect(field(snapshot, "breadth_internals")).toMatchObject({
      status: "unavailable",
      value: null,
      isProxy: false,
    });
    expect(field(snapshot, "leadership_rotation").status).toBe("missing");
    expect(field(snapshot, "vix_term_structure").status).toBe("missing");
    expect(field(snapshot, "credit_stress").status).toBe("missing");
    expect(field(snapshot, "event_gate").status).toBe("unavailable");
    expect(snapshot.isCompleteCrossSection).toBe(false);
    expect(snapshot.summary.missingCount).toBeGreaterThanOrEqual(3);
  });

  it("keeps QQQ gamma unavailable instead of reusing SPY", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-28",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: true,
    });

    const spy = field(snapshot, "spy_gamma");
    const qqq = field(snapshot, "qqq_gamma");

    expect(spy.status).not.toBe("missing");
    expect(qqq).toMatchObject({
      status: "unavailable",
      value: null,
      missingReason: expect.stringContaining("must not reuse the SPY fixture"),
    });
  });

  it("preserves bounded put/call wall order and persisted gamma flip", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-28",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    const gamma = field(snapshot, "spy_gamma").value as {
      boundedPutWall: number | null;
      boundedCallWall: number | null;
      gammaFlip: { status: string; strike?: number };
      snapshotStatus: string;
    };

    expect(gamma.boundedPutWall).toBe(743);
    expect(gamma.boundedCallWall).toBe(745);
    expect(gamma.gammaFlip.status).toBe("available");
    expect(gamma.gammaFlip.strike).toBe(745.9);
    expect(field(snapshot, "spy_gamma").status).toBe("incomplete");
  });

  it("flags cross-session macro assets without silent forward-fill", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-08-06",
      generatedAt: "2026-08-06T12:00:00-04:00",
      macro: readyMacroView(),
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    const us2y = field(snapshot, "us2y");
    expect(us2y.marketSessionDate).toBe("2026-07-28");
    expect(us2y.stale).toBe(true);
    expect(us2y.missingReason).toContain("does not match target");
    expect(snapshot.sessionAlignment).toBe("stale");
    expect(snapshot.summary.crossSessionCount).toBeGreaterThan(0);
  });

  it("maps macro USD as proxy while rates remain non-proxy", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-28",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: readyMacroView(),
      alpacaPanel: null,
      catalystFeed: null,
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    expect(field(snapshot, "usd").isProxy).toBe(true);
    expect(field(snapshot, "us2y").isProxy).toBe(false);
    expect(field(snapshot, "us10y").isProxy).toBe(false);
    expect(field(snapshot, "vix_spot").isProxy).toBe(false);
  });
});
