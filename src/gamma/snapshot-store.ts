import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  GammaHistoricalSnapshot,
  type GammaHistoricalSnapshot as GammaHistoricalSnapshotDto,
} from "@/contracts";
import { deepEqualJson } from "./deep-equal";
import { parseGammaSnapshotId } from "./snapshot-id";

export type AppendSnapshotResult =
  | { readonly outcome: "written"; readonly path: string }
  | { readonly outcome: "idempotent"; readonly path: string };

export class GammaSnapshotConflictError extends Error {
  readonly snapshotId: string;
  readonly path: string;

  constructor(snapshotId: string, path: string) {
    super(
      `gamma snapshot conflict: id ${snapshotId} already stored at ${path} with a different payload`,
    );
    this.name = "GammaSnapshotConflictError";
    this.snapshotId = snapshotId;
    this.path = path;
  }
}

/**
 * Append-only filesystem store for gamma historical snapshots.
 *
 * - same ID + same payload → idempotent
 * - same ID + different payload → reject (never overwrite)
 */
export class FileGammaSnapshotStore {
  constructor(private readonly root: string) {}

  snapshotPath(snapshot: GammaHistoricalSnapshotDto): string {
    const safeAsOf = snapshot.asOf.replace(/:/g, "");
    return join(
      this.root,
      "gamma",
      "snapshots",
      snapshot.underlying,
      snapshot.sessionDate,
      `${snapshot.captureKind}_${safeAsOf}.json`,
    );
  }

  pathForId(snapshotId: string): string {
    const parts = parseGammaSnapshotId(snapshotId);
    const safeAsOf = parts.asOf.replace(/:/g, "");
    return join(
      this.root,
      "gamma",
      "snapshots",
      parts.underlying,
      parts.sessionDate,
      `${parts.captureKind}_${safeAsOf}.json`,
    );
  }

  read(snapshotId: string): GammaHistoricalSnapshotDto | null {
    const path = this.pathForId(snapshotId);
    if (!existsSync(path)) return null;
    return this.readFile(path);
  }

  /**
   * Append a snapshot. Never overwrites a different payload.
   */
  append(snapshot: GammaHistoricalSnapshotDto): AppendSnapshotResult {
    const parsed = GammaHistoricalSnapshot.parse(snapshot);
    const expectedId = [
      parsed.underlying,
      parsed.sessionDate,
      parsed.captureKind,
      parsed.asOf,
    ].join("|");
    if (parsed.snapshotId !== expectedId) {
      throw new Error(
        `gamma snapshotId mismatch: got ${parsed.snapshotId}, expected ${expectedId}`,
      );
    }

    const path = this.snapshotPath(parsed);
    if (existsSync(path)) {
      const existing = this.readFile(path);
      if (deepEqualJson(existing, parsed)) {
        return { outcome: "idempotent", path };
      }
      throw new GammaSnapshotConflictError(parsed.snapshotId, path);
    }

    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n");
    renameSync(tmp, path);
    return { outcome: "written", path };
  }

  list(filter?: {
    readonly underlying?: string;
  }): GammaHistoricalSnapshotDto[] {
    const base = join(this.root, "gamma", "snapshots");
    if (!existsSync(base)) return [];

    const underlyings = filter?.underlying
      ? [filter.underlying]
      : readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

    const out: GammaHistoricalSnapshotDto[] = [];
    for (const underlying of underlyings) {
      const uDir = join(base, underlying);
      if (!existsSync(uDir)) continue;
      for (const session of readdirSync(uDir, { withFileTypes: true })) {
        if (!session.isDirectory()) continue;
        const sDir = join(uDir, session.name);
        for (const file of readdirSync(sDir)) {
          if (!file.endsWith(".json")) continue;
          out.push(this.readFile(join(sDir, file)));
        }
      }
    }
    return out;
  }

  private readFile(path: string): GammaHistoricalSnapshotDto {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`gamma snapshot ${path}: ${message}`);
    }
    const parsed = GammaHistoricalSnapshot.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `gamma snapshot ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return parsed.data;
  }
}
