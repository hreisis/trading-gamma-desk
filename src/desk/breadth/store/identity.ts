import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { joinStoreRelativePath } from "./path-safety";

/** Compact, filesystem-safe identity for an immutable breadth snapshot artifact. */
export function breadthSnapshotIdentity(
  snapshot: BreadthInternalsSnapshot,
): string {
  const asOfCompact = snapshot.asOf.replace(/[^0-9A-Z]/gi, "");
  return `${snapshot.marketSessionDate}_${asOfCompact}`;
}

export function breadthSnapshotRelativePath(
  universeId: string,
  identity: string,
): string {
  return joinStoreRelativePath(universeId, "snapshots", `${identity}.json`);
}

export function breadthLatestRelativePath(universeId: string): string {
  return joinStoreRelativePath(universeId, "latest.json");
}
