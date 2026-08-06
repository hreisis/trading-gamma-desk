import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BoundedGammaProviderSnapshot,
  type BoundedGammaProviderSnapshot as BoundedGammaProviderSnapshotDto,
} from "@/contracts";
import {
  boundedGammaLatestPath,
  DEFAULT_BOUNDED_GAMMA_DATA_ROOT,
} from "@/gamma/marketdata-app/paths";
import type { ArtifactIntegrityIssue } from "@/contracts/artifact-integrity";

export interface SessionBoundedGammaLoadResult {
  readonly snapshot: BoundedGammaProviderSnapshotDto | null;
  readonly snapshotPath: string | null;
  readonly issues: readonly ArtifactIntegrityIssue[];
}

function parseSnapshot(
  raw: unknown,
  path: string,
  sessionDate: string,
  issues: ArtifactIntegrityIssue[],
): BoundedGammaProviderSnapshotDto | null {
  const parsed = BoundedGammaProviderSnapshot.safeParse(raw);
  if (!parsed.success) {
    issues.push({
      artifact: "structure",
      severity: "invalid",
      message: `Bounded gamma snapshot failed contract validation: ${parsed.error.issues[0]?.message ?? "schema"}`,
      path,
    });
    return null;
  }

  const snapshot = parsed.data;
  if (snapshot.sessionDate !== sessionDate) {
    issues.push({
      artifact: "structure",
      severity: "mismatched",
      message: `Bounded gamma sessionDate ${snapshot.sessionDate} != requested ${sessionDate}.`,
      path,
    });
  }

  if (snapshot.status === "unavailable") {
    issues.push({
      artifact: "structure",
      severity: "stale",
      message: "Bounded gamma snapshot status is unavailable for this session.",
      path,
    });
  }

  return snapshot;
}

/**
 * Load bounded gamma for an exact session date — reads provider snapshot file
 * but requires snapshot.sessionDate === sessionDate (no nearest-date fallback).
 */
export function loadSessionBoundedGamma(input: {
  readonly sessionDate: string;
  readonly symbol?: string;
  readonly dataRoot?: string;
}): SessionBoundedGammaLoadResult {
  const sessionDate = input.sessionDate;
  const symbol = (input.symbol ?? "SPY").toUpperCase();
  const dataRoot =
    input.dataRoot ??
    join(process.cwd(), "data", "gamma", "providers", "marketdata-app");
  const path =
    input.dataRoot !== undefined
      ? boundedGammaLatestPath(symbol, dataRoot)
      : boundedGammaLatestPath(symbol, DEFAULT_BOUNDED_GAMMA_DATA_ROOT);
  const issues: ArtifactIntegrityIssue[] = [];

  if (!existsSync(path)) {
    issues.push({
      artifact: "structure",
      severity: "missing",
      message: `No bounded gamma snapshot on disk for ${symbol} (expected session ${sessionDate}).`,
      path,
    });
    return { snapshot: null, snapshotPath: path, issues };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push({
      artifact: "structure",
      severity: "invalid",
      message: `Bounded gamma snapshot is not valid JSON: ${message}`,
      path,
    });
    return { snapshot: null, snapshotPath: path, issues };
  }

  const snapshot = parseSnapshot(raw, path, sessionDate, issues);
  return { snapshot, snapshotPath: path, issues };
}
