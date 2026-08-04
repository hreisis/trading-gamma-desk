import type {
  BoundedGammaProviderSnapshot,
  GammaHistoricalSnapshot,
  MarketStructureStateV2,
  ReplayStructureArtifact,
} from "@/contracts";
import {
  GEX_METHODOLOGY_ID,
  GEX_METHODOLOGY_VERSION,
} from "@/contracts/estimated-gamma";
import {
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
} from "@/contracts/market-structure-state";
import {
  MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2,
  MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION,
} from "@/contracts/market-structure-state-v2";
import { join } from "node:path";
import { loadSessionBoundedGamma } from "@/desk/load-session-bounded-gamma";
import { FileGammaSnapshotStore } from "@/gamma/snapshot-store";
import { buildMarketStructureStateV2 } from "@/gamma/structure-state-v2";
import { buildStructureArtifactId } from "@/replay/identity";
import { boundedGammaRelPath } from "./paths";
import { EXCLUSION, exclusionMessage } from "./exclusion-reasons";

export type StructureResolutionKind =
  | "historical_snapshot"
  | "bounded_exact_date";

export interface ResolvedStructure {
  readonly kind: StructureResolutionKind;
  readonly artifact: ReplayStructureArtifact;
  readonly relativePath: string;
  readonly boundedSnapshot?: BoundedGammaProviderSnapshot;
  readonly marketStructureState?: MarketStructureStateV2;
  readonly historicalSnapshot?: GammaHistoricalSnapshot;
}

export interface StructureResolution {
  readonly resolved: ResolvedStructure | null;
  readonly boundedSnapshot: BoundedGammaProviderSnapshot | null;
  readonly boundedRelativePath: string | null;
  readonly exclusionReasons: string[];
}

function loadExactDateBounded(input: {
  readonly sessionDate: string;
  readonly dataRoot: string;
  readonly symbol: string;
}): {
  snapshot: BoundedGammaProviderSnapshot | null;
  relativePath: string;
  exclusionReasons: string[];
} {
  const boundedRoot = join(
    input.dataRoot,
    "gamma",
    "providers",
    "marketdata-app",
  );
  const relativePath = boundedGammaRelPath(input.symbol);
  const boundedLoad = loadSessionBoundedGamma({
    sessionDate: input.sessionDate,
    symbol: input.symbol,
    dataRoot: boundedRoot,
  });
  const exclusionReasons: string[] = [];
  for (const issue of boundedLoad.issues) {
    if (issue.severity === "mismatched") {
      exclusionReasons.push(
        exclusionMessage(EXCLUSION.STRUCTURE_DATE_MISMATCH, issue.message),
      );
    } else if (issue.severity !== "missing") {
      exclusionReasons.push(
        exclusionMessage(EXCLUSION.STRUCTURE_INVALID, issue.message),
      );
    }
  }
  const snapshot = boundedLoad.snapshot;
  if (snapshot && snapshot.synthetic) {
    exclusionReasons.push(
      exclusionMessage(EXCLUSION.STRUCTURE_SYNTHETIC, relativePath),
    );
    return { snapshot: null, relativePath, exclusionReasons };
  }
  return { snapshot: snapshot ?? null, relativePath, exclusionReasons };
}

function structureArtifactFromHistoricalSnapshot(
  snapshot: GammaHistoricalSnapshot,
  relativePath: string,
): ReplayStructureArtifact {
  return {
    kind: "ReplayStructureArtifact",
    artifactId: buildStructureArtifactId(snapshot.snapshotId),
    availableAt: snapshot.asOf,
    schemaVersion: snapshot.structureSchemaVersion,
    methodologyId: snapshot.methodologyId,
    methodologyVersion: snapshot.methodologyVersion,
    featureMethodologyId: MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
    featureMethodologyVersion: "0.1.0",
    underlying: snapshot.underlying,
    sessionDate: snapshot.sessionDate,
    snapshotId: snapshot.snapshotId,
    synthetic: snapshot.structure.synthetic,
    status: snapshot.structure.status,
    limitations: [...snapshot.structure.limitations],
  };
}

function structureArtifactFromBoundedState(
  state: MarketStructureStateV2,
): ReplayStructureArtifact {
  const snapshotId = `${state.symbol}|${state.sessionDate}|bounded|${state.asOf}`;
  return {
    kind: "ReplayStructureArtifact",
    artifactId: buildStructureArtifactId(snapshotId),
    availableAt: state.asOf,
    schemaVersion: MARKET_STRUCTURE_STATE_V2_SCHEMA_VERSION,
    methodologyId: GEX_METHODOLOGY_ID,
    methodologyVersion: GEX_METHODOLOGY_VERSION,
    featureMethodologyId: MARKET_STRUCTURE_FEATURE_METHODOLOGY_ID,
    featureMethodologyVersion: MARKET_STRUCTURE_FEATURE_METHODOLOGY_VERSION_V2,
    underlying: state.symbol,
    sessionDate: state.sessionDate,
    snapshotId,
    synthetic: state.synthetic,
    status: state.availability,
    limitations: [...state.limitations],
  };
}

function pickHistoricalSnapshot(
  snapshots: readonly GammaHistoricalSnapshot[],
  sessionDate: string,
): GammaHistoricalSnapshot | null {
  const matches = snapshots
    .filter((s) => s.sessionDate === sessionDate && !s.structure.synthetic)
    .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  return matches.at(-1) ?? null;
}

/**
 * Resolve exact-date structure — historical gamma snapshot preferred, else bounded
 * gamma with matching sessionDate. Never uses nearest/latest fallback.
 */
export function resolveExactDateStructure(input: {
  readonly sessionDate: string;
  readonly dataRoot: string;
  readonly symbol?: string;
}): StructureResolution {
  const symbol = input.symbol ?? "SPY";
  const store = new FileGammaSnapshotStore(input.dataRoot);
  const historical = store
    .list()
    .filter((s) => s.sessionDate === input.sessionDate);

  const boundedLoad = loadExactDateBounded({
    sessionDate: input.sessionDate,
    dataRoot: input.dataRoot,
    symbol,
  });
  const exclusionReasons = [...boundedLoad.exclusionReasons];

  const picked = pickHistoricalSnapshot(historical, input.sessionDate);
  if (picked) {
    const relPath = store.pathForId(picked.snapshotId).slice(
      input.dataRoot.length + 1,
    );
    return {
      resolved: {
        kind: "historical_snapshot",
        artifact: structureArtifactFromHistoricalSnapshot(picked, relPath),
        relativePath: relPath,
        historicalSnapshot: picked,
        boundedSnapshot: boundedLoad.snapshot ?? undefined,
      },
      boundedSnapshot: boundedLoad.snapshot,
      boundedRelativePath: boundedLoad.relativePath,
      exclusionReasons,
    };
  }

  const snapshot = boundedLoad.snapshot;
  if (!snapshot || snapshot.sessionDate !== input.sessionDate) {
    if (exclusionReasons.length === 0) {
      exclusionReasons.push(
        exclusionMessage(
          EXCLUSION.MISSING_EXACT_STRUCTURE,
          `no historical snapshot or exact-date bounded gamma for ${input.sessionDate}`,
        ),
      );
    }
    return {
      resolved: null,
      boundedSnapshot: snapshot,
      boundedRelativePath: boundedLoad.relativePath,
      exclusionReasons,
    };
  }

  const state = buildMarketStructureStateV2({ bounded: snapshot });
  const relPath = boundedLoad.relativePath;
  return {
    resolved: {
      kind: "bounded_exact_date",
      artifact: structureArtifactFromBoundedState(state),
      relativePath: relPath,
      boundedSnapshot: snapshot,
      marketStructureState: state,
    },
    boundedSnapshot: snapshot,
    boundedRelativePath: relPath,
    exclusionReasons,
  };
}
