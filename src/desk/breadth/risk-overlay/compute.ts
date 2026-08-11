import type {
  BreadthAdvanceDeclineMetric,
  BreadthInternalsSnapshot,
  BreadthMetricResult,
} from "@/contracts/breadth-internals";
import {
  isCurrentBreadthInternalsSnapshot,
  type StoredBreadthInternalsSnapshot,
} from "@/contracts/breadth-internals";
import {
  BREADTH_RISK_OVERLAY_SCHEMA_VERSION,
  BreadthRiskOverlayResult,
  type BreadthRiskOverlayDataStatus,
  type BreadthRiskOverlayDiagnostics,
} from "@/contracts/breadth-risk-overlay";
import { RECENT_BREADTH_SNAPSHOT_MIN } from "../store/history";

export interface ComputeBreadthRiskOverlayInput {
  readonly snapshots: readonly StoredBreadthInternalsSnapshot[];
}

const EMPTY_DIAGNOSTICS: BreadthRiskOverlayDiagnostics = {
  eligibleSessionCount: 0,
  excludedLegacy: 0,
  excludedPartial: 0,
  excludedStaleSnapshot: 0,
  excludedStaleUniverse: 0,
  excludedUnavailableMetrics: 0,
};

function metricAvailable(metric: BreadthMetricResult | undefined): boolean {
  return metric?.status === "available" && metric.denominator > 0;
}

function advanceDeclineAvailable(
  metric: BreadthAdvanceDeclineMetric | undefined,
): boolean {
  return metric?.status === "available";
}

function hasOverlayMetrics(snapshot: BreadthInternalsSnapshot): boolean {
  return (
    metricAvailable(snapshot.metrics.percentAboveMA20) &&
    metricAvailable(snapshot.metrics.percentAboveMA50) &&
    advanceDeclineAvailable(snapshot.metrics.advanceDecline)
  );
}

function auditSnapshots(
  snapshots: readonly StoredBreadthInternalsSnapshot[],
): {
  readonly diagnostics: BreadthRiskOverlayDiagnostics;
  readonly eligible: BreadthInternalsSnapshot[];
} {
  const diagnostics: BreadthRiskOverlayDiagnostics = { ...EMPTY_DIAGNOSTICS };
  const eligible: BreadthInternalsSnapshot[] = [];

  for (const snapshot of snapshots) {
    if (!isCurrentBreadthInternalsSnapshot(snapshot)) {
      diagnostics.excludedLegacy += 1;
      continue;
    }
    if (snapshot.status !== "available") {
      diagnostics.excludedPartial += 1;
      continue;
    }
    if (snapshot.stale) {
      diagnostics.excludedStaleSnapshot += 1;
      continue;
    }
    if (snapshot.universe.stale) {
      diagnostics.excludedStaleUniverse += 1;
      continue;
    }
    if (!hasOverlayMetrics(snapshot)) {
      diagnostics.excludedUnavailableMetrics += 1;
      continue;
    }
    eligible.push(snapshot);
  }

  diagnostics.eligibleSessionCount = eligible.length;
  return { diagnostics, eligible };
}

function dataStatusForSessionCount(sessionCount: number): BreadthRiskOverlayDataStatus {
  if (sessionCount === 0) return "unavailable";
  if (sessionCount < RECENT_BREADTH_SNAPSHOT_MIN) return "insufficient_history";
  return "available";
}

function buildResult(input: {
  readonly dataStatus: BreadthRiskOverlayDataStatus;
  readonly sessionCount: number;
  readonly asOf: string | null;
  readonly diagnostics: BreadthRiskOverlayDiagnostics;
}): BreadthRiskOverlayResult {
  return BreadthRiskOverlayResult.parse({
    kind: "BreadthRiskOverlay",
    schemaVersion: BREADTH_RISK_OVERLAY_SCHEMA_VERSION,
    regime: null,
    riskCap: null,
    sessionCount: input.sessionCount,
    asOf: input.asOf,
    dataStatus: input.dataStatus,
    diagnostics: input.diagnostics,
  });
}

/** Eligible schema-0.2.0 sessions only; regime and riskCap remain null until classification is approved. */
export function computeBreadthRiskOverlay(
  input: ComputeBreadthRiskOverlayInput,
): BreadthRiskOverlayResult {
  const { diagnostics, eligible } = auditSnapshots(input.snapshots);
  const sorted = [...eligible].sort((left, right) =>
    left.marketSessionDate.localeCompare(right.marketSessionDate),
  );
  const sessionCount = sorted.length;
  const asOf = sorted.at(-1)?.asOf ?? null;
  const dataStatus = dataStatusForSessionCount(sessionCount);

  return buildResult({
    dataStatus,
    sessionCount,
    asOf,
    diagnostics,
  });
}
