import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { joinStoreRelativePath } from "./path-safety";

export const RECENT_BREADTH_SNAPSHOT_MIN = 5;
export const RECENT_BREADTH_SNAPSHOT_MAX = 10;
export const RECENT_BREADTH_SNAPSHOT_DEFAULT = 10;

export function clampRecentBreadthSnapshotLimit(limit?: number): number {
  if (limit === undefined) return RECENT_BREADTH_SNAPSHOT_DEFAULT;
  return Math.max(
    RECENT_BREADTH_SNAPSHOT_MIN,
    Math.min(RECENT_BREADTH_SNAPSHOT_MAX, limit),
  );
}

export function snapshotsDirectoryRelativePath(universeId: string): string {
  return joinStoreRelativePath(universeId, "snapshots");
}

/** Parse `marketSessionDate` and as-of compact token from a snapshot filename identity. */
export function parseSnapshotIdentity(identity: string): {
  readonly marketSessionDate: string;
  readonly asOfCompact: string;
} | null {
  const match = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(identity);
  if (!match?.[1] || !match[2]) return null;
  return {
    marketSessionDate: match[1],
    asOfCompact: match[2],
  };
}

export function snapshotIdentityFromRelativePath(relativePath: string): string | null {
  const segments = relativePath.split("/");
  const filename = segments.at(-1) ?? "";
  if (!filename.endsWith(".json")) return null;
  return filename.slice(0, -".json".length);
}

export function dedupeBreadthSnapshotsBySession(
  snapshots: readonly BreadthInternalsSnapshot[],
): BreadthInternalsSnapshot[] {
  const bySession = new Map<string, BreadthInternalsSnapshot>();
  for (const snapshot of snapshots) {
    const existing = bySession.get(snapshot.marketSessionDate);
    if (!existing || snapshot.asOf > existing.asOf) {
      bySession.set(snapshot.marketSessionDate, snapshot);
    }
  }
  return [...bySession.values()].sort((left, right) =>
    right.marketSessionDate.localeCompare(left.marketSessionDate),
  );
}

export function sortSnapshotsBySessionDesc(
  snapshots: readonly BreadthInternalsSnapshot[],
): BreadthInternalsSnapshot[] {
  return [...snapshots].sort((left, right) =>
    right.marketSessionDate.localeCompare(left.marketSessionDate),
  );
}
