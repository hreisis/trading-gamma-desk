import type {
  BreadthInternalsSnapshot,
  StoredBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  BREADTH_INTERNALS_SCHEMA_VERSION,
  isCurrentBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  clampRecentBreadthSnapshotLimit,
  dedupeBreadthSnapshotsBySession,
  parseSnapshotIdentity,
  RECENT_BREADTH_SNAPSHOT_MIN,
  snapshotIdentityFromRelativePath,
} from "./history";
import type { RecentBreadthSnapshotsResult } from "./types";
import { parseStoredBreadthSnapshotJson } from "./parse";

export async function readSnapshotsFromRelativePaths(
  readRaw: (relativePath: string) => Promise<string | null>,
  relativePaths: readonly string[],
): Promise<StoredBreadthInternalsSnapshot[]> {
  const snapshots: StoredBreadthInternalsSnapshot[] = [];
  for (const relativePath of relativePaths) {
    const raw = await readRaw(relativePath);
    if (raw === null) continue;
    snapshots.push(parseStoredBreadthSnapshotJson(raw));
  }
  return snapshots;
}

export function selectSnapshotForSession(
  snapshots: readonly StoredBreadthInternalsSnapshot[],
  marketSessionDate: string,
): StoredBreadthInternalsSnapshot | null {
  const matches = snapshots.filter(
    (snapshot) => snapshot.marketSessionDate === marketSessionDate,
  );
  if (matches.length === 0) return null;
  return matches.sort((left, right) => right.asOf.localeCompare(left.asOf))[0] ?? null;
}

export function filterCurrentBreadthSnapshots(
  snapshots: readonly StoredBreadthInternalsSnapshot[],
): BreadthInternalsSnapshot[] {
  return snapshots.filter(isCurrentBreadthInternalsSnapshot);
}

export async function readRecentDedupedSnapshots(
  listRelativePaths: () => Promise<readonly string[]>,
  readRaw: (relativePath: string) => Promise<string | null>,
  limit?: number,
): Promise<RecentBreadthSnapshotsResult> {
  const paths = await listRelativePaths();
  const snapshots = await readSnapshotsFromRelativePaths(readRaw, paths);
  const currentOnly = filterCurrentBreadthSnapshots(snapshots);
  const deduped = dedupeBreadthSnapshotsBySession(currentOnly);
  const clampedLimit = clampRecentBreadthSnapshotLimit(limit);
  const series = deduped.slice(0, clampedLimit);

  if (series.length < RECENT_BREADTH_SNAPSHOT_MIN) {
    return {
      status: "insufficient_history",
      snapshots: series,
      missingReason: `Only ${series.length} schema ${BREADTH_INTERNALS_SCHEMA_VERSION} session(s) available; need at least ${RECENT_BREADTH_SNAPSHOT_MIN} for trend series.`,
    };
  }

  return {
    status: "available",
    snapshots: series,
    missingReason: null,
  };
}

export function sortSnapshotPathsBySessionDesc(
  relativePaths: readonly string[],
): string[] {
  return [...relativePaths].sort((left, right) => {
    const leftIdentity = snapshotIdentityFromRelativePath(left);
    const rightIdentity = snapshotIdentityFromRelativePath(right);
    const leftSession = leftIdentity
      ? parseSnapshotIdentity(leftIdentity)?.marketSessionDate ?? ""
      : "";
    const rightSession = rightIdentity
      ? parseSnapshotIdentity(rightIdentity)?.marketSessionDate ?? ""
      : "";
    return rightSession.localeCompare(leftSession);
  });
}

export async function readSnapshotBySessionFromStore(
  listRelativePaths: () => Promise<readonly string[]>,
  readRaw: (relativePath: string) => Promise<string | null>,
  marketSessionDate: string,
): Promise<StoredBreadthInternalsSnapshot | null> {
  const paths = await listRelativePaths();
  const matchingPaths = paths.filter((path) => {
    const identity = snapshotIdentityFromRelativePath(path);
    if (!identity) return false;
    const parsed = parseSnapshotIdentity(identity);
    return parsed?.marketSessionDate === marketSessionDate;
  });
  const snapshots = await readSnapshotsFromRelativePaths(readRaw, matchingPaths);
  return selectSnapshotForSession(snapshots, marketSessionDate);
}
