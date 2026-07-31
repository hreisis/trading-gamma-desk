import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GAMMA_CHANGE_SET_SCHEMA_VERSION,
  GammaChangeSet,
  GammaHistoricalSnapshot,
  type EstimatedGammaStructure,
} from "@/contracts";
import {
  FileGammaSnapshotStore,
  GammaSnapshotConflictError,
  GammaSnapshotIdentityError,
  ZERO_BASELINE_PCT_REASON,
  assertGammaSnapshotInvariants,
  buildGammaSnapshotId,
  captureGammaSnapshot,
  compareIsoInstants,
  computeGammaChangeSet,
  encodeSnapshotFileStem,
  selectSessionOpenBaseline,
} from "@/gamma";

const FIXTURE_ROOT = join(process.cwd(), "fixtures");

function loadFixtureSnapshot(rel: string) {
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

describe("M4-2A snapshot invariants", () => {
  const intraday = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("accepts a consistent fixture snapshot", () => {
    expect(() => assertGammaSnapshotInvariants(intraday)).not.toThrow();
    expect(GammaHistoricalSnapshot.safeParse(intraday).success).toBe(true);
  });

  it("rejects envelope/structure mismatches via Zod superRefine", () => {
    const bad = {
      ...intraday,
      underlying: "QQQ",
    };
    const parsed = GammaHistoricalSnapshot.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.path.includes("underlying"))).toBe(
      true,
    );
  });

  it("rejects snapshotId drift from embedded structure fields", () => {
    const bad = {
      ...intraday,
      snapshotId: "SPX|2026-07-29|intraday|2099-01-01T00:00:00.000Z",
    };
    const parsed = GammaHistoricalSnapshot.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.path.includes("snapshotId"))).toBe(
      true,
    );
  });

  it("rejects methodology version mismatch between envelope and structure", () => {
    const bad = {
      ...intraday,
      methodologyVersion: "9.9.9",
    };
    expect(GammaHistoricalSnapshot.safeParse(bad).success).toBe(false);
  });
});

describe("M4-2A instant ordering", () => {
  const priorClose = loadFixtureSnapshot(
    "SPX/2026-07-28/close_2026-07-28T200000.000Z.json",
  );
  const sessionOpen = loadFixtureSnapshot(
    "SPX/2026-07-29/open_2026-07-29T133000.000Z.json",
  );
  const intraday = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("compares timezone offsets by parsed instant, not string order", () => {
    const offsetOpen = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        asOf: "2026-07-29T09:30:00.000-04:00",
        source: {
          ...sessionOpen.structure.source,
          fetchedAt: "2026-07-29T09:30:00.000-04:00",
        },
      }),
    });
    const zOpen = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        asOf: "2026-07-29T13:30:00.000Z",
        source: {
          ...sessionOpen.structure.source,
          fetchedAt: "2026-07-29T13:30:00.000Z",
        },
      }),
    });
    expect(compareIsoInstants(offsetOpen.asOf, zOpen.asOf)).toBe(0);

    const laterByInstant = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        asOf: "2026-07-29T12:00:00.000-05:00",
        spot: 6500,
        source: {
          ...sessionOpen.structure.source,
          fetchedAt: "2026-07-29T12:00:00.000-05:00",
        },
      }),
    });
    const earlierByInstant = captureGammaSnapshot({
      captureKind: "open",
      structure: cloneStructure(sessionOpen.structure, {
        asOf: "2026-07-29T16:00:00.000Z",
        spot: 6400,
        source: {
          ...sessionOpen.structure.source,
          fetchedAt: "2026-07-29T16:00:00.000Z",
        },
      }),
    });
    expect(laterByInstant.asOf < earlierByInstant.asOf).toBe(true);
    expect(
      compareIsoInstants(laterByInstant.asOf, earlierByInstant.asOf),
    ).toBeGreaterThan(0);

    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        asOf: "2026-07-29T21:00:00.000Z",
        source: {
          ...intraday.structure.source,
          fetchedAt: "2026-07-29T21:00:00.000Z",
        },
      }),
    });

    expect(
      selectSessionOpenBaseline(current, [
        laterByInstant,
        earlierByInstant,
      ])?.snapshotId,
    ).toBe(laterByInstant.snapshotId);
  });

  it("emits GammaChangeSet schema 0.1.1 with explicit zero-baseline pct unavailable", () => {
    const zeroBaseline = captureGammaSnapshot({
      captureKind: "close",
      structure: cloneStructure(priorClose.structure, {
        totalGex: 0,
      }),
    });
    const current = captureGammaSnapshot({
      captureKind: "intraday",
      structure: cloneStructure(intraday.structure, {
        totalGex: 100,
      }),
    });
    const change = computeGammaChangeSet(current, [
      zeroBaseline,
      sessionOpen,
      current,
    ]);
    expect(change.schemaVersion).toBe(GAMMA_CHANGE_SET_SCHEMA_VERSION);
    expect(change.schemaVersion).toBe("0.1.1");
    expect(GammaChangeSet.safeParse(change).success).toBe(true);
    expect(change.versusPriorClose.metrics.totalGex).toMatchObject({
      status: "available",
      absoluteChange: 100,
      pctChange: {
        status: "unavailable",
        reason: ZERO_BASELINE_PCT_REASON,
      },
    });
  });
});

describe("M4-2A unsafe identity + path encoding", () => {
  it("rejects unsafe underlying characters in snapshot IDs", () => {
    expect(() =>
      buildGammaSnapshotId({
        underlying: "SPX|evil",
        sessionDate: "2026-07-29",
        captureKind: "open",
        asOf: "2026-07-29T13:30:00.000Z",
      }),
    ).toThrow(GammaSnapshotIdentityError);
    expect(() =>
      buildGammaSnapshotId({
        underlying: "../SPX",
        sessionDate: "2026-07-29",
        captureKind: "open",
        asOf: "2026-07-29T13:30:00.000Z",
      }),
    ).toThrow(GammaSnapshotIdentityError);
  });

  it("encodes offset timestamps safely in filesystem stems", () => {
    expect(
      encodeSnapshotFileStem("open", "2026-07-29T09:30:00.000-04:00"),
    ).toBe("open_2026-07-29T093000.000-0400");
  });
});

describe("M4-2A concurrent append", () => {
  it("allows exactly one writer and idempotent peers under parallel append", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42a-"));
    const store = new FileGammaSnapshotStore(root);
    const snap = loadFixtureSnapshot(
      "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
    );

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.resolve().then(() => store.append(snap)),
      ),
    );

    const written = results.filter((r) => r.outcome === "written");
    const idempotent = results.filter((r) => r.outcome === "idempotent");
    expect(written).toHaveLength(1);
    expect(idempotent).toHaveLength(11);
    expect(existsSync(written[0]!.path)).toBe(true);
    expect(store.read(snap.snapshotId)).toEqual(snap);
  });

  it("still rejects conflicting concurrent payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42a-"));
    const store = new FileGammaSnapshotStore(root);
    const snap = loadFixtureSnapshot(
      "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
    );
    const mutated = {
      ...snap,
      structure: cloneStructure(snap.structure, { spot: 9999 }),
    };

    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => store.append(snap)),
      Promise.resolve().then(() => store.append(mutated)),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(GammaSnapshotConflictError);
    expect(store.read(snap.snapshotId)?.structure.spot).toBe(6425);
  });
});
