import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  GammaHistoricalSnapshot,
  type GammaHistoricalSnapshot as GammaHistoricalSnapshotDto,
} from "@/contracts";
import { deepEqualJson } from "./deep-equal";
import {
  encodeSnapshotFileStem,
  encodeSnapshotPathSegment,
  encodeSnapshotSessionDate,
  parseGammaSnapshotId,
} from "./snapshot-id";
import { assertGammaSnapshotInvariants } from "./snapshot-integrity";
import {
  publishSnapshotAtomically,
  type SnapshotPublishHooks,
} from "./snapshot-publish";

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
 * - temp write + fsync + hard-link publication (final visible only when complete)
 */
export class FileGammaSnapshotStore {
  constructor(
    private readonly root: string,
    private readonly hooks?: SnapshotPublishHooks,
  ) {}

  snapshotPath(snapshot: GammaHistoricalSnapshotDto): string {
    return join(
      this.root,
      "gamma",
      "snapshots",
      encodeSnapshotPathSegment(snapshot.underlying),
      encodeSnapshotSessionDate(snapshot.sessionDate),
      `${encodeSnapshotFileStem(snapshot.captureKind, snapshot.asOf)}.json`,
    );
  }

  pathForId(snapshotId: string): string {
    const parts = parseGammaSnapshotId(snapshotId);
    return join(
      this.root,
      "gamma",
      "snapshots",
      encodeSnapshotPathSegment(parts.underlying),
      encodeSnapshotSessionDate(parts.sessionDate),
      `${encodeSnapshotFileStem(parts.captureKind, parts.asOf)}.json`,
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
    assertGammaSnapshotInvariants(parsed);

    const path = this.snapshotPath(parsed);
    const payload = JSON.stringify(parsed, null, 2) + "\n";

    const published = publishSnapshotAtomically(path, payload, this.hooks);
    if (published.outcome === "published") {
      return { outcome: "written", path };
    }

    const existing = this.readFile(path);
    if (deepEqualJson(existing, parsed)) {
      return { outcome: "idempotent", path };
    }
    throw new GammaSnapshotConflictError(parsed.snapshotId, path);
  }

  list(filter?: {
    readonly underlying?: string;
  }): GammaHistoricalSnapshotDto[] {
    const base = join(this.root, "gamma", "snapshots");
    if (!existsSync(base)) return [];

    const underlyings = filter?.underlying
      ? [encodeSnapshotPathSegment(filter.underlying)]
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
          if (!file.endsWith(".json") || file.startsWith(".")) continue;
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
    assertGammaSnapshotInvariants(parsed.data);
    return parsed.data;
  }
}
