import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";

export interface WriteVersionedResult {
  readonly snapshotPath: string;
  readonly snapshotIdentity: string;
}

export interface BreadthSnapshotStore {
  readonly mode: "filesystem" | "blob";

  writeVersioned(snapshot: BreadthInternalsSnapshot): Promise<WriteVersionedResult>;

  publishLatest(pointer: BreadthSnapshotPointer): Promise<void>;

  readLatestPointer(): Promise<BreadthSnapshotPointer | null>;

  readSnapshot(pointer: BreadthSnapshotPointer): Promise<BreadthInternalsSnapshot>;
}
