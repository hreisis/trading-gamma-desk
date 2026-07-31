import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GammaChangeSet,
  GammaHistoricalSnapshot,
  type EstimatedGammaStructure,
  type GammaHistoricalSnapshot as GammaHistoricalSnapshotDto,
} from "@/contracts";
import {
  FileGammaSnapshotStore,
  GammaSnapshotConflictError,
  buildGammaSnapshotId,
  captureGammaSnapshot,
  computeEstimatedGammaStructure,
  computeGammaChangeSet,
  FixtureOptionsChainProvider,
  selectPriorCloseBaseline,
  selectSessionOpenBaseline,
} from "@/gamma";

const FIXTURE_ROOT = join(process.cwd(), "fixtures");

function loadFixtureSnapshot(relUnderSnapshots: string): GammaHistoricalSnapshotDto {
  const path = join(FIXTURE_ROOT, "gamma", "snapshots", relUnderSnapshots);
  return GammaHistoricalSnapshot.parse(JSON.parse(readFileSync(path, "utf8")));
}

function cloneStructure(
  base: EstimatedGammaStructure,
  overrides: Partial<EstimatedGammaStructure>,
): EstimatedGammaStructure {
  return {
    ...base,
    ...overrides,
    source: overrides.source ?? base.source,
    methodology: overrides.methodology ?? base.methodology,
    callWall: overrides.callWall ?? base.callWall,
    putWall: overrides.putWall ?? base.putWall,
    gammaFlip: overrides.gammaFlip ?? base.gammaFlip,
    byStrike: overrides.byStrike ?? base.byStrike,
    byExpiry: overrides.byExpiry ?? base.byExpiry,
    zeroDte: overrides.zeroDte ?? base.zeroDte,
    coverage: overrides.coverage ?? base.coverage,
  };
}

describe("M4-2 capture + identity", () => {
  it("builds stable snapshotId from underlying|sessionDate|captureKind|asOf", () => {
    expect(
      buildGammaSnapshotId({
        underlying: "SPX",
        sessionDate: "2026-07-29",
        captureKind: "intraday",
        asOf: "2026-07-29T15:00:00.000Z",
      }),
    ).toBe("SPX|2026-07-29|intraday|2026-07-29T15:00:00.000Z");
  });

  it("requires explicit captureKind and embeds full EstimatedGammaStructure", () => {
    const provider = new FixtureOptionsChainProvider(
      join(process.cwd(), "fixtures", "gamma"),
    );
    const chain = provider.loadChain({
      underlying: "SPX",
      sessionDate: "2026-07-29",
    });
    expect(chain).not.toBeNull();
    const structure = computeEstimatedGammaStructure(chain!);
    const snap = captureGammaSnapshot({
      structure,
      captureKind: "close",
    });
    expect(snap.kind).toBe("GammaHistoricalSnapshot");
    expect(snap.captureKind).toBe("close");
    expect(snap.structure).toEqual(structure);
    expect(snap.snapshotId).toBe(
      buildGammaSnapshotId({
        underlying: structure.underlying,
        sessionDate: structure.sessionDate,
        captureKind: "close",
        asOf: structure.asOf,
      }),
    );
    expect(GammaHistoricalSnapshot.safeParse(snap).success).toBe(true);
  });
});

describe("M4-2 append-only store", () => {
  it("round-trips fixture snapshots through append + read", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42-"));
    const store = new FileGammaSnapshotStore(root);
    const fixtureStore = new FileGammaSnapshotStore(FIXTURE_ROOT);
    const fixtures = fixtureStore.list({ underlying: "SPX" });
    expect(fixtures.length).toBe(3);

    for (const snap of fixtures) {
      const result = store.append(snap);
      expect(result.outcome).toBe("written");
      const roundTrip = store.read(snap.snapshotId);
      expect(roundTrip).toEqual(snap);
    }
    expect(store.list({ underlying: "SPX" })).toHaveLength(3);
  });

  it("is idempotent for same ID + same payload", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42-"));
    const store = new FileGammaSnapshotStore(root);
    const snap = loadFixtureSnapshot(
      "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
    );
    expect(store.append(snap).outcome).toBe("written");
    expect(store.append(snap).outcome).toBe("idempotent");
  });

  it("rejects same ID + different payload without overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42-"));
    const store = new FileGammaSnapshotStore(root);
    const snap = loadFixtureSnapshot(
      "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
    );
    store.append(snap);
    const mutated = {
      ...snap,
      structure: cloneStructure(snap.structure, { spot: 9999 }),
    };
    expect(() => store.append(mutated)).toThrow(GammaSnapshotConflictError);
    expect(store.read(snap.snapshotId)?.structure.spot).toBe(6425);
  });

  it("propagates malformed stored JSON with path context", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42-"));
    const path = join(
      root,
      "gamma",
      "snapshots",
      "SPX",
      "2026-07-29",
      "open_2026-07-29T133000.000Z.json",
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json\n");
    const store = new FileGammaSnapshotStore(root);
    expect(() =>
      store.read("SPX|2026-07-29|open|2026-07-29T13:30:00.000Z"),
    ).toThrow(/gamma snapshot .*open_2026-07-29T133000/);
  });
});

describe("M4-2 change engine baselines", () => {
  const priorClose = loadFixtureSnapshot(
    "SPX/2026-07-28/close_2026-07-28T200000.000Z.json",
  );
  const sessionOpen = loadFixtureSnapshot(
    "SPX/2026-07-29/open_2026-07-29T133000.000Z.json",
  );
  const intraday = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("selects latest earlier-session explicit close and same-session open", () => {
    expect(
      selectPriorCloseBaseline(intraday, [priorClose, sessionOpen, intraday])
        ?.snapshotId,
    ).toBe(priorClose.snapshotId);
    expect(
      selectSessionOpenBaseline(intraday, [priorClose, sessionOpen, intraday])
        ?.snapshotId,
    ).toBe(sessionOpen.snapshotId);
  });

  it("ignores future, cross-underlying, and incompatible methodology snapshots", () => {
    const futureClose = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(priorClose.structure, {
        sessionDate: "2026-07-30",
        asOf: "2026-07-30T20:00:00.000Z",
        source: {
          ...priorClose.structure.source,
          fetchedAt: "2026-07-30T20:00:00.000Z",
        },
      }),
    });
    const otherUnderlying = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(priorClose.structure, {
        underlying: "QQQ",
        asOf: "2026-07-28T20:00:00.000Z",
      }),
    });
    const badMethodology = {
      ...priorClose,
      methodologyVersion: "9.9.9" as typeof priorClose.methodologyVersion,
      snapshotId: priorClose.snapshotId,
    };

    expect(
      selectPriorCloseBaseline(intraday, [
        futureClose,
        otherUnderlying,
        badMethodology as GammaHistoricalSnapshotDto,
      ]),
    ).toBeNull();
  });

  it("ignores same-session close when selecting prior-close baseline", () => {
    const sameSessionClose = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(intraday.structure, {
        asOf: "2026-07-29T20:00:00.000Z",
        source: {
          ...intraday.structure.source,
          fetchedAt: "2026-07-29T20:00:00.000Z",
        },
      }),
    });
    expect(
      selectPriorCloseBaseline(sameSessionClose, [
        sessionOpen,
        sameSessionClose,
        priorClose,
      ])?.snapshotId,
    ).toBe(priorClose.snapshotId);
  });

  it("computes available deltas vs prior close and session open", () => {
    const change = computeGammaChangeSet(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    expect(GammaChangeSet.safeParse(change).success).toBe(true);

    expect(change.versusPriorClose.baseline.status).toBe("available");
    expect(change.versusSessionOpen.baseline.status).toBe("available");

    expect(change.versusPriorClose.metrics.spot).toMatchObject({
      status: "available",
      current: 6425,
      baseline: 6400,
      absoluteChange: 25,
      pctChange: {
        status: "available",
        value: (25 / 6400) * 100,
      },
    });
    expect(change.versusSessionOpen.metrics.spot).toMatchObject({
      status: "available",
      current: 6425,
      baseline: 6410,
      absoluteChange: 15,
    });

    expect(change.versusPriorClose.metrics.totalGex).toMatchObject({
      status: "available",
      current: 1_200_000_000,
      baseline: 1_000_000_000,
      absoluteChange: 200_000_000,
    });

    expect(change.versusSessionOpen.metrics.callWall).toMatchObject({
      status: "available",
      currentStrike: 6500,
      baselineStrike: 6450,
      absoluteChange: 50,
    });
    expect(change.versusPriorClose.metrics.putWall).toMatchObject({
      status: "available",
      currentStrike: 6300,
      baselineStrike: 6350,
      absoluteChange: -50,
    });

    expect(change.versusSessionOpen.metrics.zeroDteShareOfGrossGex).toMatchObject(
      {
        status: "available",
        current: 0.3,
        baseline: 0.35,
      },
    );
    expect(change.versusPriorClose.metrics.gammaRegime).toMatchObject({
      status: "available",
      current: "positive",
      baseline: "positive",
      changed: false,
    });
  });

  it("returns explicit unavailable when baselines are missing", () => {
    const change = computeGammaChangeSet(sessionOpen, [sessionOpen]);
    expect(change.versusPriorClose.baseline).toEqual({
      status: "unavailable",
      reason: "no earlier-session explicit close baseline",
    });
    expect(change.versusSessionOpen.baseline).toEqual({
      status: "unavailable",
      reason: "no same-session explicit open baseline",
    });
    expect(change.versusPriorClose.metrics.spot.status).toBe("unavailable");
    expect(change.versusSessionOpen.metrics.totalGex.status).toBe(
      "unavailable",
    );
  });

  it("marks pctChange unavailable when baseline is zero", () => {
    const zeroBaseline = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(priorClose.structure, {
        totalGex: 0,
        asOf: "2026-07-28T20:00:00.000Z",
        sessionDate: "2026-07-28",
      }),
    });
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        totalGex: 100,
      }),
    });
    const change = computeGammaChangeSet(current, [zeroBaseline, sessionOpen]);
    expect(change.versusPriorClose.metrics.totalGex).toMatchObject({
      status: "available",
      current: 100,
      baseline: 0,
      absoluteChange: 100,
      pctChange: {
        status: "unavailable",
        reason: expect.stringMatching(/baseline is zero/i),
      },
    });
  });

  it("marks metric unavailable when current or baseline value is missing", () => {
    const baselineNoWall = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        callWall: {
          status: "unavailable",
          reason: "no positive call GEX strikes",
        },
      }),
    });
    const currentNullSpot = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        spot: null,
        asOf: "2026-07-29T16:00:00.000Z",
        source: {
          ...intraday.structure.source,
          fetchedAt: "2026-07-29T16:00:00.000Z",
        },
      }),
    });
    const change = computeGammaChangeSet(currentNullSpot, [
      priorClose,
      baselineNoWall,
    ]);
    expect(change.versusSessionOpen.metrics.callWall.status).toBe(
      "unavailable",
    );
    expect(change.versusSessionOpen.metrics.callWall).toMatchObject({
      reason: expect.stringMatching(/callWall unavailable on baseline/i),
    });
    expect(change.versusPriorClose.metrics.spot.status).toBe("unavailable");
    expect(change.versusPriorClose.metrics.spot).toMatchObject({
      reason: expect.stringMatching(/spot unavailable on current/i),
    });
  });

  it("does not use later asOf open as session-open baseline", () => {
    const laterOpen = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        asOf: "2026-07-29T18:00:00.000Z",
        spot: 6500,
        source: {
          ...sessionOpen.structure.source,
          fetchedAt: "2026-07-29T18:00:00.000Z",
        },
      }),
    });
    expect(
      selectSessionOpenBaseline(intraday, [laterOpen, sessionOpen])
        ?.snapshotId,
    ).toBe(sessionOpen.snapshotId);
  });
});
