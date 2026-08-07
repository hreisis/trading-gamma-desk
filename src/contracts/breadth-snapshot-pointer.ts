import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION = "0.1.0" as const;

/**
 * Atomic latest pointer for a versioned `BreadthInternalsSnapshot` artifact.
 * Written only after the immutable snapshot is stored and read-back validated.
 */
export const BreadthSnapshotPointer = z.object({
  kind: z.literal("BreadthSnapshotPointer"),
  schemaVersion: z.literal(BREADTH_SNAPSHOT_POINTER_SCHEMA_VERSION),
  universeId: z.literal("spy_etf_holdings"),
  fundSymbol: z.literal("SPY"),
  marketSessionDate: IsoDate,
  /** Store-relative path to the immutable snapshot JSON (no leading slash). */
  snapshotPath: z.string().min(1),
  /** Immutable identity for the versioned artifact (filename stem). */
  snapshotIdentity: z.string().min(1),
  /** Snapshot compute instant (`BreadthInternalsSnapshot.asOf`). */
  generatedAt: IsoDateTime,
  /** Instant the latest pointer was published. */
  publishedAt: IsoDateTime,
});

export type BreadthSnapshotPointer = z.infer<typeof BreadthSnapshotPointer>;
