import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { BreadthSnapshotPointer as BreadthSnapshotPointerSchema } from "@/contracts/breadth-snapshot-pointer";
import { BreadthStoreError } from "./errors";

export function parseBreadthSnapshotJson(raw: string): BreadthInternalsSnapshot {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return BreadthInternalsSnapshotSchema.parse(parsed);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "malformed breadth snapshot JSON";
    throw new BreadthStoreError(
      "invalid_snapshot",
      `breadth snapshot schema validation failed: ${detail}`,
    );
  }
}

export function parseBreadthPointerJson(raw: string): BreadthSnapshotPointer {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return BreadthSnapshotPointerSchema.parse(parsed);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "malformed breadth pointer JSON";
    throw new BreadthStoreError(
      "invalid_pointer",
      `breadth pointer schema validation failed: ${detail}`,
    );
  }
}

export function snapshotsEquivalent(
  left: BreadthInternalsSnapshot,
  right: BreadthInternalsSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
