import { spawn } from "node:child_process";
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
  publishSnapshotAtomically,
  writeSnapshotTempFile,
} from "@/gamma";

const FIXTURE_ROOT = join(process.cwd(), "fixtures");
const SUBPROCESS_PATH = join(
  process.cwd(),
  "tests",
  "workers",
  "gamma-snapshot-append.subprocess.ts",
);

type AppendSubprocessResult =
  | { status: "ok"; outcome: "written" | "idempotent" }
  | { status: "error"; name: string; message: string };

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

function uniqueSnapshotArgPath(): string {
  return join(
    tmpdir(),
    `gammadesk-append-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

function runAppendSubprocessAsync(
  root: string,
  snapshot: unknown,
): Promise<AppendSubprocessResult> {
  const snapshotFile = uniqueSnapshotArgPath();
  writeFileSync(snapshotFile, JSON.stringify(snapshot));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", SUBPROCESS_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GAMMADESK_APPEND_ROOT: root,
        GAMMADESK_APPEND_SNAPSHOT: snapshotFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", () => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      if (!line) {
        reject(
          new Error(
            `append subprocess produced no output (stderr: ${stderr.trim()})`,
          ),
        );
        return;
      }
      resolve(JSON.parse(line) as AppendSubprocessResult);
    });
  });
}

function tempFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.includes(".tmp."));
}

function startReaderPoll(
  store: FileGammaSnapshotStore,
  snapshotId: string,
  stop: { value: boolean },
): Promise<string[]> {
  return (async () => {
    const invalidReads: string[] = [];
    while (!stop.value) {
      const path = store.pathForId(snapshotId);
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
    return invalidReads;
  })();
}

describe("M4-2C temp write failure cleanup", () => {
  it("removes temp file when fsync fails before writeSnapshotTempFile returns", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42c-"));
    const store = new FileGammaSnapshotStore(root);
    const finalPath = store.snapshotPath(
      loadFixtureSnapshot(
        "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
      ),
    );
    const dir = join(finalPath, "..");

    expect(() =>
      writeSnapshotTempFile(finalPath, "{}", {
        beforeFsync: () => {
          throw new Error("simulated fsync failure");
        },
      }),
    ).toThrow("simulated fsync failure");

    expect(tempFilesIn(dir)).toHaveLength(0);
    expect(existsSync(finalPath)).toBe(false);
  });

  it("removes temp file when injectable publish tempWrite fails before link", () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42c-"));
    const store = new FileGammaSnapshotStore(root);
    const snap = loadFixtureSnapshot(
      "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
    );
    const finalPath = store.snapshotPath(snap);
    const dir = join(finalPath, "..");
    const payload = JSON.stringify(snap, null, 2) + "\n";

    expect(() =>
      publishSnapshotAtomically(finalPath, payload, {
        tempWrite: {
          afterOpen: () => {
            throw new Error("simulated open/write failure");
          },
        },
      }),
    ).toThrow("simulated open/write failure");

    expect(tempFilesIn(dir)).toHaveLength(0);
    expect(existsSync(finalPath)).toBe(false);
  });
});

describe("M4-2C async concurrent publication", () => {
  const snap = loadFixtureSnapshot(
    "SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json",
  );

  it("starts competing subprocess writers before awaiting and polls readers concurrently", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42c-"));
    const store = new FileGammaSnapshotStore(root);
    const stop = { value: false };

    const pollPromise = startReaderPoll(store, snap.snapshotId, stop);
    const writerPromises = Array.from({ length: 8 }, () =>
      runAppendSubprocessAsync(root, snap),
    );

    const writerResults = await Promise.all(writerPromises);
    stop.value = true;
    const invalidReads = await pollPromise;

    const ok = writerResults.filter((r) => r.status === "ok");
    expect(ok).toHaveLength(8);
    expect(ok.filter((r) => r.outcome === "written")).toHaveLength(1);
    expect(ok.filter((r) => r.outcome === "idempotent")).toHaveLength(7);
    expect(invalidReads).toHaveLength(0);
    expect(store.read(snap.snapshotId)).toEqual(snap);
  });

  it("allows either conflicting payload to win; loser conflicts and stored matches winner", async () => {
    const root = mkdtempSync(join(tmpdir(), "gammadesk-m42c-"));
    const store = new FileGammaSnapshotStore(root);
    const original = snap;
    const mutated = {
      ...snap,
      structure: cloneStructure(snap.structure, { spot: 9999 }),
    };

    const writerA = runAppendSubprocessAsync(root, original);
    const writerB = runAppendSubprocessAsync(root, mutated);
    const results = await Promise.all([writerA, writerB]);

    const ok = results.filter((r) => r.status === "ok");
    const errors = results.filter((r) => r.status === "error");
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe("GammaSnapshotConflictError");

    const stored = store.read(snap.snapshotId);
    expect(stored).not.toBeNull();

    const winner =
      stored!.structure.spot === original.structure.spot ? original : mutated;
    expect(stored).toEqual(winner);
    expect(stored!.structure.spot).toBe(winner.structure.spot);
  });
});
