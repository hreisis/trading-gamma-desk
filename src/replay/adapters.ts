import type {
  Catalyst,
  DominantDriver,
  MarketStructureState,
  ReplayCatalystArtifact,
  ReplayMacroArtifact,
  ReplayStructureArtifact,
} from "@/contracts";
import {
  buildCatalystArtifactId,
  buildMacroArtifactId,
  buildStructureArtifactId,
} from "./identity";

export class ReplayCatalystAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayCatalystAdapterError";
  }
}

/**
 * Lift a stored DominantDriver into replay corpus metadata.
 * Does not revise or recompute the driver.
 */
export function macroArtifactFromDominantDriver(
  driver: DominantDriver,
  options?: { readonly synthetic?: boolean; readonly limitations?: string[] },
): ReplayMacroArtifact {
  return {
    kind: "ReplayMacroArtifact",
    artifactId: buildMacroArtifactId(
      driver.marketSessionDate,
      driver.generatedAt,
    ),
    availableAt: driver.generatedAt,
    schemaVersion: driver.schemaVersion,
    methodologyVersion: driver.methodology.methodologyVersion,
    signatureVersion: driver.methodology.signatureVersion,
    marketSessionDate: driver.marketSessionDate,
    synthetic: options?.synthetic ?? false,
    status: driver.primaryRegime,
    limitations: options?.limitations ? [...options.limitations] : [],
  };
}

/**
 * Lift a stored MarketStructureState into replay corpus metadata.
 */
export function structureArtifactFromMarketStructureState(
  state: MarketStructureState,
): ReplayStructureArtifact {
  return {
    kind: "ReplayStructureArtifact",
    artifactId: buildStructureArtifactId(state.snapshotId),
    availableAt: state.asOf,
    schemaVersion: state.schemaVersion,
    methodologyId: state.methodologyId,
    methodologyVersion: state.methodologyVersion,
    featureMethodologyId: state.featureMethodologyId,
    featureMethodologyVersion: state.featureMethodologyVersion,
    underlying: state.underlying,
    sessionDate: state.sessionDate,
    snapshotId: state.snapshotId,
    synthetic: state.current.synthetic,
    status: state.current.structureStatus,
    limitations: [...state.current.limitations],
  };
}

/**
 * Lift a stored Catalyst into replay corpus metadata.
 * Eligibility uses explicit release/publication time only — never
 * Catalyst.occurredAt or Catalyst.observedAt (ingestion).
 */
export function catalystArtifactFromCatalyst(
  catalyst: Catalyst,
  options?: {
    readonly publishedAt?: string;
    readonly limitations?: string[];
  },
): ReplayCatalystArtifact {
  const releasePublishedAt = catalyst.releaseResult?.observedAt;

  if (catalyst.status === "upcoming" && !releasePublishedAt) {
    throw new ReplayCatalystAdapterError(
      `catalyst ${catalyst.id}: upcoming/scheduled-only catalyst lacks explicit released evidence`,
    );
  }

  const publishedAt = releasePublishedAt ?? options?.publishedAt;
  if (!publishedAt) {
    throw new ReplayCatalystAdapterError(
      `catalyst ${catalyst.id}: explicit publication timestamp required (releaseResult.observedAt or adapter publishedAt)`,
    );
  }

  return {
    kind: "ReplayCatalystArtifact",
    artifactId: buildCatalystArtifactId(catalyst.id),
    publishedAt,
    schemaVersion: catalyst.schemaVersion,
    catalystId: catalyst.id,
    synthetic: catalyst.synthetic,
    status: catalyst.status,
    limitations: options?.limitations ? [...options.limitations] : [],
  };
}
