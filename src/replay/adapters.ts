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
 * Eligibility uses explicit release/publication time:
 * releaseResult.observedAt when present, otherwise occurredAt.
 */
export function catalystArtifactFromCatalyst(
  catalyst: Catalyst,
  options?: { readonly limitations?: string[] },
): ReplayCatalystArtifact {
  const publishedAt =
    catalyst.releaseResult?.observedAt ?? catalyst.occurredAt;
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
