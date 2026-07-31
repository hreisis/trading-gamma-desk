import type { GammaHistoricalSnapshot } from "@/contracts";
import { buildGammaSnapshotId } from "./snapshot-id";

export class GammaSnapshotInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GammaSnapshotInvariantError";
  }
}

/**
 * Enforce M4-2A snapshot invariants: envelope fields must match embedded structure.
 */
export function assertGammaSnapshotInvariants(
  snapshot: GammaHistoricalSnapshot,
): void {
  const expectedId = buildGammaSnapshotId({
    underlying: snapshot.underlying,
    sessionDate: snapshot.sessionDate,
    captureKind: snapshot.captureKind,
    asOf: snapshot.asOf,
  });
  if (snapshot.snapshotId !== expectedId) {
    throw new GammaSnapshotInvariantError(
      `snapshotId mismatch: got ${snapshot.snapshotId}, expected ${expectedId}`,
    );
  }

  const s = snapshot.structure;
  if (snapshot.underlying !== s.underlying) {
    throw new GammaSnapshotInvariantError(
      `underlying mismatch: envelope ${snapshot.underlying} vs structure ${s.underlying}`,
    );
  }
  if (snapshot.sessionDate !== s.sessionDate) {
    throw new GammaSnapshotInvariantError(
      `sessionDate mismatch: envelope ${snapshot.sessionDate} vs structure ${s.sessionDate}`,
    );
  }
  if (snapshot.asOf !== s.asOf) {
    throw new GammaSnapshotInvariantError(
      `asOf mismatch: envelope ${snapshot.asOf} vs structure ${s.asOf}`,
    );
  }
  if (snapshot.structureSchemaVersion !== s.schemaVersion) {
    throw new GammaSnapshotInvariantError(
      `structureSchemaVersion mismatch: envelope ${snapshot.structureSchemaVersion} vs structure ${s.schemaVersion}`,
    );
  }
  if (snapshot.methodologyId !== s.methodology.id) {
    throw new GammaSnapshotInvariantError(
      `methodologyId mismatch: envelope ${snapshot.methodologyId} vs structure ${s.methodology.id}`,
    );
  }
  if (snapshot.methodologyVersion !== s.methodology.version) {
    throw new GammaSnapshotInvariantError(
      `methodologyVersion mismatch: envelope ${snapshot.methodologyVersion} vs structure ${s.methodology.version}`,
    );
  }
}
