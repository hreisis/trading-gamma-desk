import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GammaHistoricalSnapshot, type EstimatedGammaStructure } from "@/contracts";
import {
  FileGammaSnapshotStore,
  GammaSnapshotConflictError,
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

function tempFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.includes(".tmp."));
}

describe("M4-2B atomic snapshot publication", () => {
  const snap = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("does not expose the final path until after temp write + link", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const reader = new FileGammaSnapshotStore(root);
    let observedDuringWrite = false;

    const writer = new FileGammaSnapshotStore(root, {
      afterTempWrite: ({ tempPath, finalPath }) => {
        expect(existsSync(tempPath)).toBe(true);
        expect(existsSync(finalPath)).toBe(false);
        expect(reader.read(snap.snapshotId)).toBeNull();
        expect(() => JSON.parse(readFileSync(tempPath, "utf8"))).not.toThrow();
        observedDuringWrite = true;
      },
      beforeLink: ({ finalPath }) => {
        expect(existsSync(finalPath)).toBe(false);
      },
    });

    const result = writer.append(snap);
    expect(result.outcome).toBe("written");
    expect(observedDuringWrite).toBe(true);
    expect(reader.read(snap.snapshotId)).toEqual(snap);
  });

  it("cleans temp files after successful publication", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const store = new FileGammaSnapshotStore(root);
    const result = store.append(snap);
    const dir = join(result.path, "..");
    expect(tempFilesIn(dir)).toHaveLength(0);
  });

  it("cleans temp files when publication finds an existing final", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const store = new FileGammaSnapshotStore(root);
    const first = store.append(snap);
    const second = store.append(snap);
    expect(second.outcome).toBe("idempotent");
    const dir = join(first.path, "..");
    expect(tempFilesIn(dir)).toHaveLength(0);
  });

  it("cleans temp files when publication hits a conflict", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const store = new FileGammaSnapshotStore(root);
    store.append(snap);
    const mutated = {
      ...snap,
      structure: cloneStructure(snap.structure, { spot: 9999 }),
    };
    expect(() => store.append(mutated)).toThrow(GammaSnapshotConflictError);
    const dir = store.snapshotPath(snap);
    expect(tempFilesIn(join(dir, ".."))).toHaveLength(0);
    expect(store.read(snap.snapshotId)?.structure.spot).toBe(6425);
  });
});
