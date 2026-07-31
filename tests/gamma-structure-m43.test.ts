import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GammaChangeSet,
  GammaHistoricalSnapshot,
  MarketStructureState,
  type EstimatedGammaStructure,
  type GammaChangeSet as GammaChangeSetDto,
  type GammaHistoricalSnapshot as GammaHistoricalSnapshotDto,
} from "@/contracts";
import {
  MarketStructurePairError,
  buildMarketStructureState,
  captureGammaSnapshot,
  computeGammaChangeSet,
} from "@/gamma";

const FIXTURE_ROOT = join(process.cwd(), "fixtures");

function loadSnapshot(rel: string): GammaHistoricalSnapshotDto {
  const path = join(FIXTURE_ROOT, "gamma", "snapshots", rel);
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

const priorClose = loadSnapshot(
  "SPX/2026-07-28/close_2026-07-28T200000.000Z.json",
);
const sessionOpen = loadSnapshot(
  "SPX/2026-07-29/open_2026-07-29T133000.000Z.json",
);
const intraday = loadSnapshot(
  "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
);

function changeFor(
  current: GammaHistoricalSnapshotDto,
  candidates: GammaHistoricalSnapshotDto[],
): GammaChangeSetDto {
  return computeGammaChangeSet(current, candidates);
}

describe("M4-3 MarketStructureState complete fixture path", () => {
  it("builds contract-valid state from fixture snapshots", () => {
    const changeSet = changeFor(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    const state = buildMarketStructureState(intraday, changeSet);
    expect(MarketStructureState.safeParse(state).success).toBe(true);
    expect(state.kind).toBe("MarketStructureState");
    expect(state.current.gammaRegime).toBe("positive");
    expect(state.current.spotWallCorridor).toMatchObject({
      status: "available",
      position: "between_walls",
      putWallStrike: 6300,
      callWallStrike: 6500,
      spot: 6425,
    });
    expect(state.current.distanceToCallWall).toMatchObject({
      status: "available",
      points: 6425 - 6500,
      pct: { status: "available", value: ((6425 - 6500) / 6500) * 100 },
    });
    expect(state.current.distanceToPutWall).toMatchObject({
      status: "available",
      points: 6425 - 6300,
    });
    expect(state.current.zeroDteShareOfGrossGex).toEqual({
      status: "available",
      value: 0.3,
    });
    expect(state.current.coverageRatio).toMatchObject({
      status: "available",
      contractsUsed: 2,
      contractsIn: 2,
      value: 1,
    });
    expect(state.current.structureStatus).toBe("available");
    expect(state.current.dataDelay).toBe("fixture");
    expect(state.current.synthetic).toBe(true);

    expect(state.versusPriorClose.baseline.status).toBe("available");
    expect(state.versusSessionOpen.baseline.status).toBe("available");
    expect(state.versusPriorClose.totalGexDirection).toEqual({
      status: "available",
      direction: "higher",
    });
    expect(state.versusSessionOpen.callWallShiftDirection).toEqual({
      status: "available",
      direction: "higher",
    });
    expect(state.versusPriorClose.putWallShiftDirection).toEqual({
      status: "available",
      direction: "lower",
    });
    expect(state.versusSessionOpen.zeroDteShareOfGrossGexDirection).toEqual({
      status: "available",
      direction: "lower",
    });
    expect(state.versusPriorClose.metrics.spot.status).toBe("available");
  });

  it("is deterministic for identical inputs and does not mutate them", () => {
    const changeSet = changeFor(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    const snapCopy = structuredClone(intraday);
    const changeCopy = structuredClone(changeSet);
    const a = buildMarketStructureState(intraday, changeSet);
    const b = buildMarketStructureState(intraday, changeSet);
    expect(a).toEqual(b);
    expect(intraday).toEqual(snapCopy);
    expect(changeSet).toEqual(changeCopy);
  });
});

describe("M4-3 missing baseline and transitions", () => {
  it("preserves unavailable baseline reasons from M4-2", () => {
    const changeSet = changeFor(sessionOpen, [sessionOpen]);
    const state = buildMarketStructureState(sessionOpen, changeSet);
    expect(state.versusPriorClose.baseline).toEqual({
      status: "unavailable",
      reason: "no earlier-session explicit close baseline",
    });
    expect(state.versusSessionOpen.baseline).toEqual({
      status: "unavailable",
      reason: "no same-session explicit open baseline",
    });
    expect(state.versusPriorClose.totalGexDirection).toMatchObject({
      status: "unavailable",
      direction: "unavailable",
    });
    expect(state.versusPriorClose.metrics.totalGex.status).toBe("unavailable");
  });

  it("reports gamma regime transitions when changed", () => {
    const negativeOpen = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        gammaRegime: "negative",
        totalGex: -100,
      }),
    });
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        gammaRegime: "positive",
        totalGex: 100,
      }),
    });
    const changeSet = changeFor(current, [priorClose, negativeOpen, current]);
    const state = buildMarketStructureState(current, changeSet);
    expect(state.versusSessionOpen.gammaRegimeTransition).toMatchObject({
      status: "available",
      current: "positive",
      baseline: "negative",
      changed: true,
    });
    expect(state.versusSessionOpen.totalGexDirection).toEqual({
      status: "available",
      direction: "higher",
    });
  });

  it("represents zero-baseline pct as unavailable while keeping absolute change", () => {
    const zeroClose = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(priorClose.structure, { totalGex: 0 }),
    });
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, { totalGex: 100 }),
    });
    const changeSet = changeFor(current, [zeroClose, sessionOpen, current]);
    const state = buildMarketStructureState(current, changeSet);
    expect(state.versusPriorClose.metrics.totalGex).toMatchObject({
      status: "available",
      absoluteChange: 100,
      pctChange: {
        status: "unavailable",
        reason: expect.stringMatching(/baseline is zero/i),
      },
    });
    expect(state.versusPriorClose.totalGexDirection).toEqual({
      status: "available",
      direction: "higher",
    });
  });
});

describe("M4-3 walls and coverage", () => {
  it("marks corridor unavailable when a wall is missing but keeps other wall distance", () => {
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        putWall: {
          status: "unavailable",
          reason: "no negative put GEX strikes",
        },
      }),
    });
    const changeSet = changeFor(current, [priorClose, sessionOpen, current]);
    const state = buildMarketStructureState(current, changeSet);
    expect(state.current.spotWallCorridor).toMatchObject({
      status: "unavailable",
      reason: "putWall unavailable",
      position: "unavailable",
    });
    expect(state.current.distanceToPutWall.status).toBe("unavailable");
    expect(state.current.distanceToCallWall.status).toBe("available");
  });

  it("marks corridor unavailable when putWall >= callWall; keeps individual distances", () => {
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        putWall: { status: "available", strike: 6600, gex: -1 },
        callWall: { status: "available", strike: 6500, gex: 1 },
      }),
    });
    const changeSet = changeFor(current, [priorClose, sessionOpen, current]);
    const state = buildMarketStructureState(current, changeSet);
    expect(state.current.spotWallCorridor).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/putWall >= callWall/i),
    });
    expect(state.current.distanceToPutWall.status).toBe("available");
    expect(state.current.distanceToCallWall.status).toBe("available");
  });

  it("classifies exact wall strikes without epsilon", () => {
    const atPut = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        spot: 6300,
        asOf: "2026-07-29T15:05:00.000Z",
        source: {
          ...intraday.structure.source,
          fetchedAt: "2026-07-29T15:05:00.000Z",
        },
      }),
    });
    const atCall = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        spot: 6500,
        asOf: "2026-07-29T15:06:00.000Z",
        source: {
          ...intraday.structure.source,
          fetchedAt: "2026-07-29T15:06:00.000Z",
        },
      }),
    });
    expect(
      buildMarketStructureState(
        atPut,
        changeFor(atPut, [priorClose, sessionOpen, atPut]),
      ).current.spotWallCorridor,
    ).toMatchObject({ status: "available", position: "at_put_wall" });
    expect(
      buildMarketStructureState(
        atCall,
        changeFor(atCall, [priorClose, sessionOpen, atCall]),
      ).current.spotWallCorridor,
    ).toMatchObject({ status: "available", position: "at_call_wall" });
  });

  it("marks coverage ratio unavailable when contractsIn is zero", () => {
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        coverage: {
          contractsIn: 0,
          contractsUsed: 0,
          contractsSkipped: 0,
          skipReasons: {},
        },
        status: "unavailable",
        totalGex: null,
        gammaRegime: "unavailable",
      }),
    });
    const changeSet = changeFor(current, [priorClose, sessionOpen, current]);
    const state = buildMarketStructureState(current, changeSet);
    expect(state.current.coverageRatio).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/contractsIn is zero/i),
    });
  });
});

describe("M4-3 identity / version mismatch", () => {
  it("rejects mismatched snapshotId / underlying / methodology pairs", () => {
    const changeSet = changeFor(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    expect(() =>
      buildMarketStructureState(sessionOpen, changeSet),
    ).toThrow(MarketStructurePairError);

    const badUnderlying = {
      ...changeSet,
      underlying: "QQQ",
    };
    expect(() =>
      buildMarketStructureState(intraday, badUnderlying as GammaChangeSetDto),
    ).toThrow(/underlying mismatch/i);

    const badMethod = {
      ...changeSet,
      methodologyVersion: "9.9.9",
    };
    expect(() =>
      buildMarketStructureState(intraday, badMethod as GammaChangeSetDto),
    ).toThrow(/methodologyVersion mismatch/i);
  });

  it("rejects unsupported change-set schema versions", () => {
    const changeSet = changeFor(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    const bad = {
      ...changeSet,
      schemaVersion: "0.0.1",
    };
    expect(() =>
      buildMarketStructureState(intraday, bad as GammaChangeSetDto),
    ).toThrow(/unsupported changeSet schemaVersion/i);
  });
});

describe("M4-3 fixture artifact", () => {
  it("matches the checked-in MarketStructureState fixture", () => {
    const changeSet = changeFor(intraday, [
      priorClose,
      sessionOpen,
      intraday,
    ]);
    const state = buildMarketStructureState(intraday, changeSet);
    const outPath = join(
      FIXTURE_ROOT,
      "gamma",
      "structure",
      "spx.2026-07-29.intraday.market-structure-state.json",
    );
    const reloaded = MarketStructureState.parse(
      JSON.parse(readFileSync(outPath, "utf8")),
    );
    expect(reloaded).toEqual(state);
    expect(GammaChangeSet.safeParse(changeSet).success).toBe(true);
  });
});
