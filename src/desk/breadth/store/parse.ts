import type {
  BreadthInternalsSnapshot,
  StoredBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION,
  BREADTH_INTERNALS_SCHEMA_VERSION,
  BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema,
  BreadthInternalsSnapshotLegacy as BreadthInternalsSnapshotLegacySchema,
  StoredBreadthInternalsSnapshot as StoredBreadthInternalsSnapshotSchema,
} from "@/contracts/breadth-internals";
import type { BreadthSnapshotPointer } from "@/contracts/breadth-snapshot-pointer";
import { BreadthSnapshotPointer as BreadthSnapshotPointerSchema } from "@/contracts/breadth-snapshot-pointer";
import { BreadthStoreError } from "./errors";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredSchemaVersion(parsed: unknown): string | null {
  if (!isRecord(parsed)) return null;
  const schemaVersion = parsed.schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : null;
}

/** Parse stored JSON preserving legacy schema version and field names. */
export function parseStoredBreadthSnapshotJson(
  raw: string,
): StoredBreadthInternalsSnapshot {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const schemaVersion = readStoredSchemaVersion(parsed);
    if (schemaVersion === BREADTH_INTERNALS_LEGACY_SCHEMA_VERSION) {
      return BreadthInternalsSnapshotLegacySchema.parse(parsed);
    }
    if (schemaVersion === BREADTH_INTERNALS_SCHEMA_VERSION) {
      return BreadthInternalsSnapshotSchema.parse(parsed);
    }
    return StoredBreadthInternalsSnapshotSchema.parse(parsed);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "malformed breadth snapshot JSON";
    throw new BreadthStoreError(
      "invalid_snapshot",
      `breadth snapshot schema validation failed: ${detail}`,
    );
  }
}

/** Parse current (0.2.0) snapshots only — rejects legacy stored artifacts. */
export function parseBreadthSnapshotJson(raw: string): BreadthInternalsSnapshot {
  const stored = parseStoredBreadthSnapshotJson(raw);
  if (stored.schemaVersion !== BREADTH_INTERNALS_SCHEMA_VERSION) {
    throw new BreadthStoreError(
      "invalid_snapshot",
      `expected breadth snapshot schema ${BREADTH_INTERNALS_SCHEMA_VERSION}, got ${stored.schemaVersion}`,
    );
  }
  return stored;
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
  left: StoredBreadthInternalsSnapshot,
  right: StoredBreadthInternalsSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
