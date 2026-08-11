import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BreadthInternalsSnapshot,
  StoredBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema,
  isCurrentBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { SPY_BREADTH_CONFIG } from "../config";
import { BreadthStoreError } from "./errors";
import {
  breadthLatestRelativePath,
  breadthSnapshotIdentity,
  breadthSnapshotRelativePath,
} from "./identity";
import {
  snapshotsDirectoryRelativePath,
} from "./history";
import {
  readRecentDedupedSnapshots,
  readSnapshotBySessionFromStore,
} from "./snapshot-queries";
import { assertSafeStoreRelativePath } from "./path-safety";
import {
  parseBreadthPointerJson,
  parseStoredBreadthSnapshotJson,
  snapshotsEquivalent,
} from "./parse";
import type { BreadthSnapshotStore } from "./types";

export interface FilesystemBreadthSnapshotStoreOptions {
  readonly dataRoot: string;
  readonly namespace?: string;
  readonly universeId?: string;
  readonly fundSymbol?: string;
}

function storeRoot(options: FilesystemBreadthSnapshotStoreOptions): string {
  const namespace = options.namespace ?? "breadth";
  return join(options.dataRoot, namespace);
}

function absoluteFromRelative(
  root: string,
  relativePath: string,
): string {
  assertSafeStoreRelativePath(relativePath);
  const absolute = join(root, relativePath);
  const normalizedRoot = join(root);
  if (!absolute.startsWith(normalizedRoot + "/") && absolute !== normalizedRoot) {
    throw new BreadthStoreError(
      "path_escape",
      `resolved path escapes store root: ${relativePath}`,
    );
  }
  return absolute;
}

export function createFilesystemBreadthSnapshotStore(
  options: FilesystemBreadthSnapshotStoreOptions,
): BreadthSnapshotStore {
  const universeId = options.universeId ?? SPY_BREADTH_CONFIG.universeId;
  const fundSymbol = options.fundSymbol ?? SPY_BREADTH_CONFIG.fundSymbol;
  const root = storeRoot(options);

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
        "pointer universe/fund does not match filesystem store binding",
      );
    }
  }

  return {
    mode: "filesystem",

    async writeVersioned(snapshot) {
      const validated = BreadthInternalsSnapshotSchema.parse(snapshot);
      assertSnapshotBinding(validated);

      const identity = breadthSnapshotIdentity(validated);
      const snapshotPath = breadthSnapshotRelativePath(universeId, identity);
      const absolutePath = absoluteFromRelative(root, snapshotPath);

      if (existsSync(absolutePath)) {
        const existing = parseStoredBreadthSnapshotJson(
          readFileSync(absolutePath, "utf8"),
        );
        if (!snapshotsEquivalent(existing, validated)) {
          throw new BreadthStoreError(
            "identity_conflict",
            `immutable snapshot already exists with different content: ${snapshotPath}`,
          );
        }
        return { snapshotPath, snapshotIdentity: identity };
      }

      try {
        writeJsonAtomic(absolutePath, validated);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BreadthStoreError(
          "write_failed",
          `filesystem snapshot write failed: ${detail}`,
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
      const absoluteLatest = absoluteFromRelative(root, latestPath);

      try {
        writeJsonAtomic(absoluteLatest, pointer);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BreadthStoreError(
          "publish_failed",
          `filesystem latest pointer write failed: ${detail}`,
        );
      }
    },

    async readLatestPointer() {
      const latestPath = breadthLatestRelativePath(universeId);
      const absoluteLatest = absoluteFromRelative(root, latestPath);
      if (!existsSync(absoluteLatest)) {
        return null;
      }
      return parseBreadthPointerJson(readFileSync(absoluteLatest, "utf8"));
    },

    async readSnapshot(pointer) {
      assertPointerBinding(pointer);
      assertSafeStoreRelativePath(pointer.snapshotPath);

      const absolutePath = absoluteFromRelative(root, pointer.snapshotPath);
      if (!existsSync(absolutePath)) {
        throw new BreadthStoreError(
          "read_failed",
          `snapshot file not found: ${pointer.snapshotPath}`,
        );
      }

      return parseStoredBreadthSnapshotJson(readFileSync(absolutePath, "utf8"));
    },

    async readSnapshotBySessionDate(marketSessionDate) {
      return readSnapshotBySessionFromStore(
        async () => listFilesystemSnapshotPaths(root, universeId),
        async (relativePath) => {
          const absolutePath = absoluteFromRelative(root, relativePath);
          if (!existsSync(absolutePath)) return null;
          return readFileSync(absolutePath, "utf8");
        },
        marketSessionDate,
      );
    },

    async readRecentSnapshots(options) {
      return readRecentDedupedSnapshots(
        async () => listFilesystemSnapshotPaths(root, universeId),
        async (relativePath) => {
          const absolutePath = absoluteFromRelative(root, relativePath);
          if (!existsSync(absolutePath)) return null;
          return readFileSync(absolutePath, "utf8");
        },
        options?.limit,
      );
    },
  };
}

function listFilesystemSnapshotPaths(
  root: string,
  universeId: string,
): string[] {
  const snapshotsDir = join(root, snapshotsDirectoryRelativePath(universeId));
  if (!existsSync(snapshotsDir)) return [];
  return readdirSync(snapshotsDir)
    .filter((filename) => filename.endsWith(".json"))
    .map((filename) => {
      const identity = filename.slice(0, -".json".length);
      return breadthSnapshotRelativePath(universeId, identity);
    });
}

function assertPublishableSnapshotForLatest(
  snapshot: StoredBreadthInternalsSnapshot,
  pointer: BreadthSnapshotPointer,
): void {
  if (!isCurrentBreadthInternalsSnapshot(snapshot)) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      `cannot publish latest pointer to schema ${snapshot.schemaVersion} snapshot`,
    );
  }
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
