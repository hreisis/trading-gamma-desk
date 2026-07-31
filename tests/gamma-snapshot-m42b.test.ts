import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
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
const SUBPROCESS_PATH = join(
  process.cwd(),
  "tests",
  "workers",
  "gamma-snapshot-append.subprocess.ts",
);

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

function runAppendSubprocess(
  root: string,
  snapshot: unknown,
): { status: "ok"; outcome: "written" | "idempotent" } | { status: "error"; name: string; message: string } {
  const snapshotFile = join(
    tmpdir(),
    `gammadesk-append-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(snapshotFile, JSON.stringify(snapshot));

  const result = spawnSync(process.execPath, ["--import", "tsx", SUBPROCESS_PATH], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GAMMADESK_APPEND_ROOT: root,
      GAMMADESK_APPEND_SNAPSHOT: snapshotFile,
    },
    encoding: "utf8",
  });

  const line = (result.stdout ?? "").trim().split("\n").pop() ?? "";
  if (!line) {
    throw new Error(
      `append subprocess produced no output (stderr: ${result.stderr ?? ""})`,
    );
  }
  return JSON.parse(line) as ReturnType<typeof runAppendSubprocess>;
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

describe("M4-2B concurrent publication", () => {
  const snap = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("allows one writer and idempotent peers across concurrent subprocesses", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => runAppendSubprocess(root, snap)),
      ),
    );

    const ok = results.filter((r) => r.status === "ok");
    expect(ok).toHaveLength(8);
    const written = ok.filter((r) => r.outcome === "written");
    const idempotent = ok.filter((r) => r.outcome === "idempotent");
    expect(written).toHaveLength(1);
    expect(idempotent).toHaveLength(7);

    const store = new FileGammaSnapshotStore(root);
    expect(store.read(snap.snapshotId)).toEqual(snap);
  });

  it("rejects conflicting concurrent subprocess writers without overwrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const mutated = {
      ...snap,
      structure: cloneStructure(snap.structure, { spot: 9999 }),
    };

    const results = await Promise.all([
      Promise.resolve().then(() => runAppendSubprocess(root, snap)),
      Promise.resolve().then(() => runAppendSubprocess(root, mutated)),
    ]);

    const ok = results.filter((r) => r.status === "ok");
    const errors = results.filter((r) => r.status === "error");
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe("GammaSnapshotConflictError");

    const store = new FileGammaSnapshotStore(root);
    expect(store.read(snap.snapshotId)?.structure.spot).toBe(6425);
  });

  it("never exposes partial JSON to concurrent readers during subprocess publication", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42b-"));
    const store = new FileGammaSnapshotStore(root);
    const stop = { value: false };
    const invalidReads: string[] = [];

    const pollPromise = (async () => {
      while (!stop.value) {
        const path = store.pathForId(snap.snapshotId);
        if (existsSync(path)) {
          const raw = readFileSync(path, "utf8");
          try {
            GammaHistoricalSnapshot.parse(JSON.parse(raw));
          } catch {
            invalidReads.push(raw.slice(0, 40));
          }
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();

    const workerResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => runAppendSubprocess(root, snap)),
      ),
    );

    stop.value = true;
    await pollPromise;

    expect(workerResults.filter((r) => r.status === "ok")).toHaveLength(8);
    expect(invalidReads).toHaveLength(0);
    expect(store.read(snap.snapshotId)).toEqual(snap);
  });
});
