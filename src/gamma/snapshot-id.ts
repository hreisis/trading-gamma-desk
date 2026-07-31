import type { GammaSnapshotCaptureKind } from "@/contracts";

export interface GammaSnapshotIdParts {
  readonly underlying: string;
  readonly sessionDate: string;
  readonly captureKind: GammaSnapshotCaptureKind;
  readonly asOf: string;
}

/**
 * Stable snapshot identity. Components are explicit capture labels — never
 * derived from wall-clock inference.
 */
export function buildGammaSnapshotId(parts: GammaSnapshotIdParts): string {
  return [
    parts.underlying,
    parts.sessionDate,
    parts.captureKind,
    parts.asOf,
  ].join("|");
}

export function parseGammaSnapshotId(snapshotId: string): GammaSnapshotIdParts {
  const parts = snapshotId.split("|");
  if (parts.length !== 4) {
    throw new Error(
      `invalid gamma snapshotId (expected underlying|sessionDate|captureKind|asOf): ${snapshotId}`,
    );
  }
  const underlying = parts[0]!;
  const sessionDate = parts[1]!;
  const captureKind = parts[2]!;
  const asOf = parts[3]!;
  if (
    captureKind !== "open" &&
    captureKind !== "intraday" &&
    captureKind !== "close"
  ) {
    throw new Error(
      `invalid gamma snapshotId captureKind: ${snapshotId}`,
    );
  }
  return { underlying, sessionDate, captureKind, asOf };
}
