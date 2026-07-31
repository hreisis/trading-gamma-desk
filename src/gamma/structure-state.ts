import {
  ESTIMATED_GAMMA_SCHEMA_VERSION,
  GAMMA_CHANGE_SET_SCHEMA_VERSION,
  GAMMA_SNAPSHOT_SCHEMA_VERSION,
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION,
  MARKET_STRUCTURE_STATE_SCHEMA_VERSION,
  MarketStructureState,
  type CoverageRatio,
  type DirectedChange,
  type GammaBaselineComparison,
  type GammaChangeSet,
  type GammaHistoricalSnapshot,
  type GammaNumericChange,
  type GammaWallChange,
  type MarketStructureState as MarketStructureStateDto,
  type SpotWallCorridor,
  type StructureBaselineFeatures,
  type WallDistance,
  type WallLevel,
  type ZeroDteShareFeature,
} from "@/contracts";

export class MarketStructurePairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketStructurePairError";
  }
}

/**
 * Reject mismatched snapshot / change-set pairs before deriving features.
 */
export function assertMatchingSnapshotChangeSet(
  snapshot: GammaHistoricalSnapshot,
  changeSet: GammaChangeSet,
): void {
  if (changeSet.currentSnapshotId !== snapshot.snapshotId) {
    throw new MarketStructurePairError(
      `currentSnapshotId mismatch: changeSet ${changeSet.currentSnapshotId} vs snapshot ${snapshot.snapshotId}`,
    );
  }
  if (changeSet.underlying !== snapshot.underlying) {
    throw new MarketStructurePairError(
      `underlying mismatch: changeSet ${changeSet.underlying} vs snapshot ${snapshot.underlying}`,
    );
  }
  if (changeSet.sessionDate !== snapshot.sessionDate) {
    throw new MarketStructurePairError(
      `sessionDate mismatch: changeSet ${changeSet.sessionDate} vs snapshot ${snapshot.sessionDate}`,
    );
  }
  if (changeSet.asOf !== snapshot.asOf) {
    throw new MarketStructurePairError(
      `asOf mismatch: changeSet ${changeSet.asOf} vs snapshot ${snapshot.asOf}`,
    );
  }
  if (changeSet.captureKind !== snapshot.captureKind) {
    throw new MarketStructurePairError(
      `captureKind mismatch: changeSet ${changeSet.captureKind} vs snapshot ${snapshot.captureKind}`,
    );
  }
  if (changeSet.methodologyId !== snapshot.methodologyId) {
    throw new MarketStructurePairError(
      `methodologyId mismatch: changeSet ${changeSet.methodologyId} vs snapshot ${snapshot.methodologyId}`,
    );
  }
  if (changeSet.methodologyVersion !== snapshot.methodologyVersion) {
    throw new MarketStructurePairError(
      `methodologyVersion mismatch: changeSet ${changeSet.methodologyVersion} vs snapshot ${snapshot.methodologyVersion}`,
    );
  }
  if (snapshot.schemaVersion !== GAMMA_SNAPSHOT_SCHEMA_VERSION) {
    throw new MarketStructurePairError(
      `unsupported snapshot schemaVersion: ${snapshot.schemaVersion}`,
    );
  }
  if (changeSet.schemaVersion !== GAMMA_CHANGE_SET_SCHEMA_VERSION) {
    throw new MarketStructurePairError(
      `unsupported changeSet schemaVersion: ${changeSet.schemaVersion}`,
    );
  }
  if (snapshot.structureSchemaVersion !== ESTIMATED_GAMMA_SCHEMA_VERSION) {
    throw new MarketStructurePairError(
      `unsupported structureSchemaVersion: ${snapshot.structureSchemaVersion}`,
    );
  }
}

function wallDistance(
  label: string,
  spot: number | null,
  wall: WallLevel,
): WallDistance {
  if (spot === null) {
    return { status: "unavailable", reason: "spot unavailable" };
  }
  if (wall.status !== "available" || wall.strike === undefined) {
    return {
      status: "unavailable",
      reason: `${label} unavailable`,
    };
  }
  const wallStrike = wall.strike;
  const points = spot - wallStrike;
  const pct =
    wallStrike === 0
      ? {
          status: "unavailable" as const,
          reason: "wall strike is zero; percentage distance undefined",
        }
      : {
          status: "available" as const,
          value: (points / wallStrike) * 100,
        };
  return {
    status: "available",
    wallStrike,
    spot,
    points,
    pct,
  };
}

function spotWallCorridor(
  spot: number | null,
  putWall: WallLevel,
  callWall: WallLevel,
): SpotWallCorridor {
  if (spot === null) {
    return {
      status: "unavailable",
      reason: "spot unavailable",
      position: "unavailable",
    };
  }
  if (putWall.status !== "available" || putWall.strike === undefined) {
    return {
      status: "unavailable",
      reason: "putWall unavailable",
      position: "unavailable",
    };
  }
  if (callWall.status !== "available" || callWall.strike === undefined) {
    return {
      status: "unavailable",
      reason: "callWall unavailable",
      position: "unavailable",
    };
  }
  const putWallStrike = putWall.strike;
  const callWallStrike = callWall.strike;
  if (putWallStrike >= callWallStrike) {
    return {
      status: "unavailable",
      reason: "putWall >= callWall; corridor undefined",
      position: "unavailable",
    };
  }

  let position:
    | "below_put_wall"
    | "at_put_wall"
    | "between_walls"
    | "at_call_wall"
    | "above_call_wall";
  if (spot < putWallStrike) position = "below_put_wall";
  else if (spot === putWallStrike) position = "at_put_wall";
  else if (spot < callWallStrike) position = "between_walls";
  else if (spot === callWallStrike) position = "at_call_wall";
  else position = "above_call_wall";

  return {
    status: "available",
    position,
    putWallStrike,
    callWallStrike,
    spot,
  };
}

function coverageRatio(
  contractsUsed: number,
  contractsIn: number,
): CoverageRatio {
  if (contractsIn === 0) {
    return {
      status: "unavailable",
      reason: "contractsIn is zero; coverage ratio undefined",
      contractsUsed,
      contractsIn,
    };
  }
  return {
    status: "available",
    contractsUsed,
    contractsIn,
    value: contractsUsed / contractsIn,
  };
}

function zeroDteShare(
  snapshot: GammaHistoricalSnapshot,
): ZeroDteShareFeature {
  const z = snapshot.structure.zeroDte;
  if (z.status === "unavailable") {
    return {
      status: "unavailable",
      reason: z.reason ?? "zeroDte unavailable",
    };
  }
  if (z.shareOfGrossGex === null) {
    return {
      status: "unavailable",
      reason: "zeroDte shareOfGrossGex unavailable",
    };
  }
  return { status: "available", value: z.shareOfGrossGex };
}

function directionFromAbsoluteChange(
  absoluteChange: number,
): DirectedChange {
  if (absoluteChange > 0) {
    return { status: "available", direction: "higher" };
  }
  if (absoluteChange < 0) {
    return { status: "available", direction: "lower" };
  }
  return { status: "available", direction: "unchanged" };
}

function numericDirection(change: GammaNumericChange): DirectedChange {
  if (change.status === "unavailable") {
    return {
      status: "unavailable",
      reason: change.reason,
      direction: "unavailable",
    };
  }
  return directionFromAbsoluteChange(change.absoluteChange);
}

function wallShiftDirection(change: GammaWallChange): DirectedChange {
  if (change.status === "unavailable") {
    return {
      status: "unavailable",
      reason: change.reason,
      direction: "unavailable",
    };
  }
  return directionFromAbsoluteChange(change.absoluteChange);
}

function baselineFeatures(
  comparison: GammaBaselineComparison,
): StructureBaselineFeatures {
  return {
    baseline: comparison.baseline,
    gammaRegimeTransition: comparison.metrics.gammaRegime,
    totalGexDirection: numericDirection(comparison.metrics.totalGex),
    callWallShiftDirection: wallShiftDirection(comparison.metrics.callWall),
    putWallShiftDirection: wallShiftDirection(comparison.metrics.putWall),
    zeroDteShareOfGrossGexDirection: numericDirection(
      comparison.metrics.zeroDteShareOfGrossGex,
    ),
    metrics: comparison.metrics,
  };
}

/**
 * Pure: build contract-valid MarketStructureState from a matched snapshot +
 * change set. Does not mutate inputs. No forecasts, scores, or invented fills.
 */
export function buildMarketStructureState(
  snapshot: GammaHistoricalSnapshot,
  changeSet: GammaChangeSet,
): MarketStructureStateDto {
  assertMatchingSnapshotChangeSet(snapshot, changeSet);

  const structure = snapshot.structure;
  const spot = structure.spot;

  const result: MarketStructureStateDto = {
    kind: "MarketStructureState",
    schemaVersion: MARKET_STRUCTURE_STATE_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId,
    underlying: snapshot.underlying,
    sessionDate: snapshot.sessionDate,
    asOf: snapshot.asOf,
    captureKind: snapshot.captureKind,
    methodologyId: snapshot.methodologyId,
    methodologyVersion: snapshot.methodologyVersion,
    featureMethodologyId: MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
    featureMethodologyVersion: MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION,
    sourceSnapshotSchemaVersion: GAMMA_SNAPSHOT_SCHEMA_VERSION,
    sourceChangeSetSchemaVersion: GAMMA_CHANGE_SET_SCHEMA_VERSION,
    sourceStructureSchemaVersion: ESTIMATED_GAMMA_SCHEMA_VERSION,
    current: {
      gammaRegime: structure.gammaRegime,
      spotWallCorridor: spotWallCorridor(
        spot,
        structure.putWall,
        structure.callWall,
      ),
      distanceToCallWall: wallDistance("callWall", spot, structure.callWall),
      distanceToPutWall: wallDistance("putWall", spot, structure.putWall),
      zeroDteShareOfGrossGex: zeroDteShare(snapshot),
      coverageRatio: coverageRatio(
        structure.coverage.contractsUsed,
        structure.coverage.contractsIn,
      ),
      structureStatus: structure.status,
      dataDelay: structure.dataDelay,
      synthetic: structure.synthetic,
      limitations: [...structure.limitations],
    },
    versusPriorClose: baselineFeatures(changeSet.versusPriorClose),
    versusSessionOpen: baselineFeatures(changeSet.versusSessionOpen),
  };

  return MarketStructureState.parse(result);
}
