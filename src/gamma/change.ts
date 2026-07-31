import {
  GammaChangeSet,
  GAMMA_CHANGE_SET_SCHEMA_VERSION,
  type GammaBaselineComparison,
  type GammaBaselineRef,
  type GammaChangeMetrics,
  type GammaChangeSet as GammaChangeSetDto,
  type GammaHistoricalSnapshot,
  type GammaNumericChange,
  type GammaPctChange,
  type GammaRegimeChange,
  type GammaWallChange,
  type WallLevel,
} from "@/contracts";
import { compareIsoInstants, parseIsoInstantMs } from "./instant";

const ZERO_BASELINE_PCT_REASON =
  "baseline is zero; percentage change undefined";

function pctChangeField(current: number, baseline: number): GammaPctChange {
  if (baseline === 0) {
    return { status: "unavailable", reason: ZERO_BASELINE_PCT_REASON };
  }
  return {
    status: "available",
    value: ((current - baseline) / baseline) * 100,
  };
}

function unavailableNumeric(
  reason: string,
  current?: number | null,
  baseline?: number | null,
): GammaNumericChange {
  return {
    status: "unavailable",
    reason,
    current: current ?? null,
    baseline: baseline ?? null,
  };
}

function availableNumeric(
  current: number,
  baseline: number,
): GammaNumericChange {
  return {
    status: "available",
    current,
    baseline,
    absoluteChange: current - baseline,
    pctChange: pctChangeField(current, baseline),
  };
}

function compareNullableNumber(
  label: string,
  current: number | null,
  baseline: number | null,
): GammaNumericChange {
  if (current === null && baseline === null) {
    return unavailableNumeric(`${label} unavailable on current and baseline`);
  }
  if (current === null) {
    return unavailableNumeric(`${label} unavailable on current`, null, baseline);
  }
  if (baseline === null) {
    return unavailableNumeric(
      `${label} unavailable on baseline`,
      current,
      null,
    );
  }
  return availableNumeric(current, baseline);
}

function compareRegime(
  current: GammaHistoricalSnapshot["structure"]["gammaRegime"],
  baseline: GammaHistoricalSnapshot["structure"]["gammaRegime"],
): GammaRegimeChange {
  return {
    status: "available",
    current,
    baseline,
    changed: current !== baseline,
  };
}

function compareWall(
  label: string,
  current: WallLevel,
  baseline: WallLevel,
): GammaWallChange {
  if (current.status !== "available" || current.strike === undefined) {
    return {
      status: "unavailable",
      reason: `${label} unavailable on current`,
      currentStrike: current.strike,
      baselineStrike: baseline.strike,
    };
  }
  if (baseline.status !== "available" || baseline.strike === undefined) {
    return {
      status: "unavailable",
      reason: `${label} unavailable on baseline`,
      currentStrike: current.strike,
      baselineStrike: baseline.strike,
    };
  }
  return {
    status: "available",
    currentStrike: current.strike,
    baselineStrike: baseline.strike,
    absoluteChange: current.strike - baseline.strike,
    pctChange: pctChangeField(current.strike, baseline.strike),
  };
}

function zeroDteShare(
  snap: GammaHistoricalSnapshot,
): number | null {
  const z = snap.structure.zeroDte;
  if (z.status === "unavailable") return null;
  return z.shareOfGrossGex;
}

function compareMetrics(
  current: GammaHistoricalSnapshot,
  baseline: GammaHistoricalSnapshot,
): GammaChangeMetrics {
  return {
    spot: compareNullableNumber(
      "spot",
      current.structure.spot,
      baseline.structure.spot,
    ),
    totalGex: compareNullableNumber(
      "totalGex",
      current.structure.totalGex,
      baseline.structure.totalGex,
    ),
    gammaRegime: compareRegime(
      current.structure.gammaRegime,
      baseline.structure.gammaRegime,
    ),
    callWall: compareWall(
      "callWall",
      current.structure.callWall,
      baseline.structure.callWall,
    ),
    putWall: compareWall(
      "putWall",
      current.structure.putWall,
      baseline.structure.putWall,
    ),
    zeroDteShareOfGrossGex: compareNullableNumber(
      "zeroDteShareOfGrossGex",
      zeroDteShare(current),
      zeroDteShare(baseline),
    ),
  };
}

function allUnavailableMetrics(reason: string): GammaChangeMetrics {
  return {
    spot: unavailableNumeric(reason),
    totalGex: unavailableNumeric(reason),
    gammaRegime: { status: "unavailable", reason },
    callWall: { status: "unavailable", reason },
    putWall: { status: "unavailable", reason },
    zeroDteShareOfGrossGex: unavailableNumeric(reason),
  };
}

function isCompatible(
  current: GammaHistoricalSnapshot,
  candidate: GammaHistoricalSnapshot,
): boolean {
  return (
    candidate.underlying === current.underlying &&
    candidate.structureSchemaVersion === current.structureSchemaVersion &&
    candidate.methodologyId === current.methodologyId &&
    candidate.methodologyVersion === current.methodologyVersion &&
    candidate.schemaVersion === current.schemaVersion
  );
}

function isNotFuture(
  candidate: GammaHistoricalSnapshot,
  current: GammaHistoricalSnapshot,
): boolean {
  if (candidate.sessionDate > current.sessionDate) return false;
  if (compareIsoInstants(candidate.asOf, current.asOf) > 0) return false;
  return true;
}

function compareSnapshotRecency(
  a: GammaHistoricalSnapshot,
  b: GammaHistoricalSnapshot,
): number {
  if (a.sessionDate !== b.sessionDate) {
    return a.sessionDate < b.sessionDate ? 1 : -1;
  }
  const byInstant = compareIsoInstants(b.asOf, a.asOf);
  if (byInstant !== 0) return byInstant;
  return a.snapshotId < b.snapshotId ? 1 : -1;
}

function baselineRef(snap: GammaHistoricalSnapshot): GammaBaselineRef {
  return {
    status: "available",
    snapshotId: snap.snapshotId,
    sessionDate: snap.sessionDate,
    captureKind: snap.captureKind,
    asOf: snap.asOf,
  };
}

function comparisonFromBaseline(
  current: GammaHistoricalSnapshot,
  baseline: GammaHistoricalSnapshot | null,
  missingReason: string,
): GammaBaselineComparison {
  if (!baseline) {
    return {
      baseline: { status: "unavailable", reason: missingReason },
      metrics: allUnavailableMetrics(missingReason),
    };
  }
  return {
    baseline: baselineRef(baseline),
    metrics: compareMetrics(current, baseline),
  };
}

/**
 * Latest earlier-session explicit close that is compatible and not future.
 * Never uses open/intraday, same session, cross-underlying, or mismatched
 * schema/methodology.
 */
export function selectPriorCloseBaseline(
  current: GammaHistoricalSnapshot,
  candidates: readonly GammaHistoricalSnapshot[],
): GammaHistoricalSnapshot | null {
  const eligible = candidates.filter(
    (c) =>
      c.snapshotId !== current.snapshotId &&
      c.captureKind === "close" &&
      c.sessionDate < current.sessionDate &&
      isCompatible(current, c) &&
      isNotFuture(c, current),
  );
  if (eligible.length === 0) return null;

  eligible.sort(compareSnapshotRecency);
  return eligible[0] ?? null;
}

/**
 * Same-session explicit open that is compatible, not future, and not the
 * current snapshot itself.
 */
export function selectSessionOpenBaseline(
  current: GammaHistoricalSnapshot,
  candidates: readonly GammaHistoricalSnapshot[],
): GammaHistoricalSnapshot | null {
  const eligible = candidates.filter(
    (c) =>
      c.snapshotId !== current.snapshotId &&
      c.captureKind === "open" &&
      c.sessionDate === current.sessionDate &&
      isCompatible(current, c) &&
      isNotFuture(c, current),
  );
  if (eligible.length === 0) return null;

  eligible.sort(compareSnapshotRecency);
  return eligible[0] ?? null;
}

/**
 * Pure: build a contract-valid change set for `current` against candidate history.
 * Does not invent baselines or fill missing metrics.
 */
export function computeGammaChangeSet(
  current: GammaHistoricalSnapshot,
  candidates: readonly GammaHistoricalSnapshot[],
): GammaChangeSetDto {
  const priorClose = selectPriorCloseBaseline(current, candidates);
  const sessionOpen = selectSessionOpenBaseline(current, candidates);

  const result: GammaChangeSetDto = {
    kind: "GammaChangeSet",
    schemaVersion: GAMMA_CHANGE_SET_SCHEMA_VERSION,
    currentSnapshotId: current.snapshotId,
    underlying: current.underlying,
    sessionDate: current.sessionDate,
    asOf: current.asOf,
    captureKind: current.captureKind,
    methodologyId: current.methodologyId,
    methodologyVersion: current.methodologyVersion,
    versusPriorClose: comparisonFromBaseline(
      current,
      priorClose,
      "no earlier-session explicit close baseline",
    ),
    versusSessionOpen: comparisonFromBaseline(
      current,
      sessionOpen,
      "no same-session explicit open baseline",
    ),
  };

  return GammaChangeSet.parse(result);
}

export { parseIsoInstantMs, ZERO_BASELINE_PCT_REASON };
