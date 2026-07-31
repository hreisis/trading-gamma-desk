import {
  GammaHistoricalSnapshot,
  GAMMA_SNAPSHOT_SCHEMA_VERSION,
  type EstimatedGammaStructure,
  type GammaHistoricalSnapshot as GammaHistoricalSnapshotDto,
  type GammaSnapshotCaptureKind,
} from "@/contracts";
import { buildGammaSnapshotId } from "./snapshot-id";

export interface CaptureGammaSnapshotInput {
  readonly structure: EstimatedGammaStructure;
  /**
   * Explicit capture kind. Never inferred from asOf / clock time.
   */
  readonly captureKind: GammaSnapshotCaptureKind;
  /** When the snapshot was captured into the store; defaults to structure.asOf. */
  readonly capturedAt?: string;
}

/**
 * Wrap a validated M4-1 structure into an immutable M4-2 historical snapshot.
 */
export function captureGammaSnapshot(
  input: CaptureGammaSnapshotInput,
): GammaHistoricalSnapshotDto {
  const { structure, captureKind } = input;
  const asOf = structure.asOf;
  const snapshotId = buildGammaSnapshotId({
    underlying: structure.underlying,
    sessionDate: structure.sessionDate,
    captureKind,
    asOf,
  });

  const snapshot: GammaHistoricalSnapshotDto = {
    kind: "GammaHistoricalSnapshot",
    schemaVersion: GAMMA_SNAPSHOT_SCHEMA_VERSION,
    snapshotId,
    captureKind,
    capturedAt: input.capturedAt ?? asOf,
    underlying: structure.underlying,
    sessionDate: structure.sessionDate,
    asOf,
    structureSchemaVersion: structure.schemaVersion,
    methodologyId: structure.methodology.id,
    methodologyVersion: structure.methodology.version,
    structure,
  };

  return GammaHistoricalSnapshot.parse(snapshot);
}
