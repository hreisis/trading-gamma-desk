import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { SPY_BREADTH_CONFIG } from "../config";
import type { BlobStoreClient } from "./blob-client";
import { BreadthStoreError } from "./errors";
import {
  breadthLatestRelativePath,
  breadthSnapshotIdentity,
  breadthSnapshotRelativePath,
} from "./identity";
import { assertSafeStoreRelativePath } from "./path-safety";
import {
  parseBreadthPointerJson,
  parseBreadthSnapshotJson,
  snapshotsEquivalent,
} from "./parse";
import type { BreadthSnapshotStore } from "./types";

export interface BlobBreadthSnapshotStoreOptions {
  readonly client: BlobStoreClient | null;
  readonly prefix?: string;
  readonly universeId?: string;
  readonly fundSymbol?: string;
}

function blobKey(prefix: string, relativePath: string): string {
  assertSafeStoreRelativePath(relativePath);
  const trimmedPrefix = prefix.replace(/\/+$/g, "");
  if (trimmedPrefix.length === 0) {
    return relativePath;
  }
  assertSafeStoreRelativePath(trimmedPrefix);
  return `${trimmedPrefix}/${relativePath}`;
}

export function createBlobBreadthSnapshotStore(
  options: BlobBreadthSnapshotStoreOptions,
): BreadthSnapshotStore {
  if (!options.client) {
    return createUnavailableBlobBreadthSnapshotStore();
  }

  const client = options.client;
  const prefix = options.prefix ?? "breadth";
  const universeId = options.universeId ?? SPY_BREADTH_CONFIG.universeId;
  const fundSymbol = options.fundSymbol ?? SPY_BREADTH_CONFIG.fundSymbol;

  function assertSnapshotBinding(snapshot: BreadthInternalsSnapshot): void {
    if (snapshot.universe.universeId !== universeId) {
      throw new BreadthStoreError(
        "invalid_snapshot",
        `snapshot universeId ${snapshot.universe.universeId} does not match store ${universeId}`,
      );
    }
    if (snapshot.universe.fundSymbol !== fundSymbol) {
      throw new BreadthStoreError(
        "invalid_snapshot",
        `snapshot fundSymbol ${snapshot.universe.fundSymbol} does not match store ${fundSymbol}`,
      );
    }
  }

  function assertPointerBinding(pointer: BreadthSnapshotPointer): void {
    if (pointer.universeId !== universeId || pointer.fundSymbol !== fundSymbol) {
      throw new BreadthStoreError(
        "invalid_pointer",
        "pointer universe/fund does not match blob store binding",
      );
    }
  }

  return {
    mode: "blob",

    async writeVersioned(snapshot) {
      const validated = BreadthInternalsSnapshotSchema.parse(snapshot);
      assertSnapshotBinding(validated);

      const identity = breadthSnapshotIdentity(validated);
      const snapshotPath = breadthSnapshotRelativePath(universeId, identity);
      const key = blobKey(prefix, snapshotPath);
      const body = JSON.stringify(validated, null, 2) + "\n";

      const existingRaw = await client.get(key);
      if (existingRaw !== null) {
        const existing = parseBreadthSnapshotJson(existingRaw);
        if (!snapshotsEquivalent(existing, validated)) {
          throw new BreadthStoreError(
            "identity_conflict",
            `immutable blob snapshot already exists with different content: ${snapshotPath}`,
          );
        }
        return { snapshotPath, snapshotIdentity: identity };
      }

      try {
        await client.put(key, body);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BreadthStoreError(
          "write_failed",
          `blob snapshot write failed: ${detail}`,
        );
      }

      return { snapshotPath, snapshotIdentity: identity };
    },

    async publishLatest(pointer) {
      assertPointerBinding(pointer);
      assertSafeStoreRelativePath(pointer.snapshotPath);

      const snapshot = await this.readSnapshot(pointer);
      assertPublishableSnapshotForLatest(snapshot, pointer);

      const latestPath = breadthLatestRelativePath(universeId);
      const key = blobKey(prefix, latestPath);
      const body = JSON.stringify(pointer, null, 2) + "\n";

      try {
        await client.put(key, body);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BreadthStoreError(
          "publish_failed",
          `blob latest pointer write failed: ${detail}`,
        );
      }
    },

    async readLatestPointer() {
      const latestPath = breadthLatestRelativePath(universeId);
      const key = blobKey(prefix, latestPath);
      const raw = await client.get(key);
      if (raw === null) {
        return null;
      }
      return parseBreadthPointerJson(raw);
    },

    async readSnapshot(pointer) {
      assertPointerBinding(pointer);
      assertSafeStoreRelativePath(pointer.snapshotPath);

      const key = blobKey(prefix, pointer.snapshotPath);
      const raw = await client.get(key);
      if (raw === null) {
        throw new BreadthStoreError(
          "read_failed",
          `blob snapshot not found: ${pointer.snapshotPath}`,
        );
      }
      return parseBreadthSnapshotJson(raw);
    },
  };
}

function assertPublishableSnapshotForLatest(
  snapshot: BreadthInternalsSnapshot,
  pointer: BreadthSnapshotPointer,
): void {
  if (snapshot.status === "unavailable") {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "cannot publish latest pointer to unavailable breadth snapshot",
    );
  }
  if (snapshot.marketSessionDate !== pointer.marketSessionDate) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "pointer marketSessionDate does not match snapshot",
    );
  }
  if (snapshot.asOf !== pointer.generatedAt) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      "pointer generatedAt does not match snapshot asOf",
    );
  }
}

function createUnavailableBlobBreadthSnapshotStore(): BreadthSnapshotStore {
  const unavailable = async () => {
    throw new BreadthStoreError(
      "unavailable",
      "breadth blob store is not configured",
    );
  };

  return {
    mode: "blob",
    writeVersioned: unavailable,
    publishLatest: unavailable,
    readLatestPointer: unavailable,
    readSnapshot: unavailable,
  };
}

export function createInMemoryBlobStoreClient(
  initial?: Record<string, string>,
): BlobStoreClient & { readonly entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial ?? {}));
  return {
    entries,
    async put(path, body) {
      entries.set(path, body);
    },
    async get(path) {
      return entries.get(path) ?? null;
    },
  };
}
