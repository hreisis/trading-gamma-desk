import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import {
  BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema,
  isCurrentBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
  type BreadthSnapshotPointer,
} from "@/contracts/breadth-snapshot-pointer";
import { BreadthSnapshotPointer as BreadthSnapshotPointerSchema } from "@/contracts/breadth-snapshot-pointer";
import { BreadthStoreError } from "./errors";
import { snapshotsEquivalent } from "./parse";
import type { BreadthSnapshotStore } from "./types";

function assertPublishableSnapshot(snapshot: BreadthInternalsSnapshot): void {
  if (snapshot.status === "unavailable") {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "cannot publish breadth snapshot with status unavailable",
    );
  }
  if (snapshot.kind !== "BreadthInternals") {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "snapshot kind must be BreadthInternals",
    );
  }
}

/**
 * Publish-last orchestration:
 * write immutable versioned snapshot → read-back validate → atomically update latest pointer.
 */
export async function publishBreadthSnapshot(
  store: BreadthSnapshotStore,
  snapshot: BreadthInternalsSnapshot,
  publishedAt: string,
): Promise<BreadthSnapshotPointer> {
  const validated = BreadthInternalsSnapshotSchema.parse(snapshot);
  assertPublishableSnapshot(validated);

  let writeResult: Awaited<ReturnType<BreadthSnapshotStore["writeVersioned"]>>;
  try {
    writeResult = await store.writeVersioned(validated);
  } catch (error) {
    if (error instanceof BreadthStoreError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new BreadthStoreError(
      "write_failed",
      `versioned breadth snapshot write failed: ${detail}`,
    );
  }

  const preliminaryPointer = BreadthSnapshotPointerSchema.parse({
    kind: "BreadthSnapshotPointer",
    schemaVersion: BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION,
    universeId: validated.universe.universeId,
    fundSymbol: validated.universe.fundSymbol,
    marketSessionDate: validated.marketSessionDate,
    snapshotPath: writeResult.snapshotPath,
    snapshotIdentity: writeResult.snapshotIdentity,
    generatedAt: validated.asOf,
    publishedAt,
  });

  let readBack;
  try {
    readBack = await store.readSnapshot(preliminaryPointer);
  } catch (error) {
    if (error instanceof BreadthStoreError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new BreadthStoreError(
      "read_failed",
      `breadth snapshot read-back failed: ${detail}`,
    );
  }

  if (!isCurrentBreadthInternalsSnapshot(readBack)) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      `read-back snapshot schema ${readBack.schemaVersion} is not publishable`,
    );
  }

  if (!snapshotsEquivalent(readBack, validated)) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "read-back snapshot does not match written snapshot",
    );
  }

  const pointer: BreadthSnapshotPointer = {
    ...preliminaryPointer,
    publishedAt,
  };

  try {
    await store.publishLatest(pointer);
  } catch (error) {
    if (error instanceof BreadthStoreError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new BreadthStoreError(
      "publish_failed",
      `latest pointer publish failed; prior latest retained: ${detail}`,
    );
  }

  return pointer;
}
