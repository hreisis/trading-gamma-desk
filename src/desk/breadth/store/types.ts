import type {
  BreadthInternalsSnapshot,
  StoredBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";

export interface WriteVersionedResult {
  readonly snapshotPath: string;
  readonly snapshotIdentity: string;
}

export interface ReadRecentBreadthSnapshotsOptions {
  /** Clamped to 5–10; defaults to 10. */
  readonly limit?: number;
}

export type RecentBreadthSnapshotSeriesStatus =
  | "available"
  | "insufficient_history";

export interface RecentBreadthSnapshotsResult {
  /** `available` only when at least 5 schema-0.2.0 sessions are present. */
  readonly status: RecentBreadthSnapshotSeriesStatus;
  /** Schema 0.2.0 snapshots only — never padded with legacy 0.1.0. */
  readonly snapshots: readonly BreadthInternalsSnapshot[];
  readonly missingReason: string | null;
}

export interface BreadthSnapshotStore {
  readonly mode: "filesystem" | "blob";

  writeVersioned(snapshot: BreadthInternalsSnapshot): Promise<WriteVersionedResult>;

  publishLatest(pointer: BreadthSnapshotPointer): Promise<void>;

  readLatestPointer(): Promise<BreadthSnapshotPointer | null>;

  readSnapshot(pointer: BreadthSnapshotPointer): Promise<StoredBreadthInternalsSnapshot>;

  readSnapshotBySessionDate(
    marketSessionDate: string,
  ): Promise<StoredBreadthInternalsSnapshot | null>;

  readRecentSnapshots(
    options?: ReadRecentBreadthSnapshotsOptions,
  ): Promise<RecentBreadthSnapshotsResult>;
}
