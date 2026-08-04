import type {
  ArchiveComponent,
  BoundedGammaProviderSnapshot,
  DominantDriver,
  ReplayCorpus,
  ReplayMacroArtifact,
  StudyEligibility,
} from "@/contracts";
import {
  RealArchiveSessionSourcesManifest,
  type RealArchiveInventoryEntry,
  type RealArchiveSessionClassification,
  type RealArchiveSessionSourcesManifest as ManifestDto,
} from "@/contracts/real-archive";
import { loadSessionDriver } from "@/desk/load-session-driver";
import { macroArtifactFromDominantDriver } from "@/replay/adapters";
import { buildMacroArtifactId } from "@/replay/identity";
import { assessStudyEligibility } from "../eligibility";
import {
  defaultEvaluationInstants,
  type DriverCandidate,
} from "./discover-candidates";
import { EXCLUSION, exclusionMessage } from "./exclusion-reasons";
import { resolvePitCatalysts } from "./load-pit-catalysts";
import { boundedGammaRelPath, driverRelPath } from "./paths";
import { resolveExactDateStructure } from "./resolve-structure";

export class RealArchiveResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealArchiveResolveError";
  }
}

export interface ResolvedRealArchiveSession {
  readonly sessionDate: string;
  readonly classification: RealArchiveSessionClassification;
  readonly exclusionReasons: string[];
  readonly sourcesManifest: ManifestDto;
  readonly driver: DominantDriver | null;
  readonly macroArtifact: ReplayMacroArtifact | null;
  readonly components: {
    readonly macro: ArchiveComponent;
    readonly marketStructure: ArchiveComponent;
    readonly boundedStructure: ArchiveComponent;
    readonly catalystEvidence: readonly ArchiveComponent[];
  };
  readonly corpus: ReplayCorpus | null;
  readonly eligibility: StudyEligibility | null;
  readonly exactDateStructure: boolean;
  readonly catalystPitAvailable: boolean;
}

function macroComponentFromDriver(
  driver: DominantDriver,
  relativePath: string,
): { macro: ArchiveComponent; artifact: ReplayMacroArtifact } {
  const artifact = macroArtifactFromDominantDriver(driver, { synthetic: false });
  return {
    artifact,
    macro: {
      status: "available",
      kind: "macro",
      provenance: {
        sourceKind: "local_store",
        relativePath,
        artifactId: artifact.artifactId,
        schemaVersion: artifact.schemaVersion,
        availableAt: artifact.availableAt,
        synthetic: false,
      },
      limitations: [...artifact.limitations],
      marketSessionDate: driver.marketSessionDate,
    },
  };
}

function boundedComponentFromSnapshot(
  snapshot: BoundedGammaProviderSnapshot,
  relativePath: string,
): ArchiveComponent {
  if (!snapshot) {
    return {
      status: "unavailable",
      kind: "bounded_structure",
      reason: "bounded structure not resolved",
    };
  }
  const artifactId = `bounded|${snapshot.symbol}|${snapshot.expiration}|${snapshot.sessionDate}`;
  return {
    status: "available",
    kind: "bounded_structure",
    provenance: {
      sourceKind: "local_store",
      relativePath,
      artifactId,
      schemaVersion: snapshot.schemaVersion,
      availableAt: snapshot.vendorAsOf,
      synthetic: false,
    },
    limitations: [...snapshot.limitations],
    scope: snapshot.scope,
    expiration: snapshot.expiration,
    dte: snapshot.dte,
    gammaAvailability: snapshot.status,
    symbol: snapshot.symbol,
    sessionDate: snapshot.sessionDate,
  };
}

function buildCorpusFromSession(input: {
  readonly driver: DominantDriver;
  readonly macroArtifact: ReplayMacroArtifact;
  readonly structureArtifact: NonNullable<
    ReturnType<typeof resolveExactDateStructure>["resolved"]
  >["artifact"];
  readonly catalystArtifacts: ReturnType<
    typeof resolvePitCatalysts
  >["artifacts"];
}): ReplayCorpus {
  const macro = input.macroArtifact;
  const structure = input.structureArtifact;
  return {
    kind: "ReplayCorpus",
    schemaVersion: "0.1.0",
    macroCompatibility: {
      schemaVersion: macro.schemaVersion,
      methodologyVersion: macro.methodologyVersion,
      signatureVersion: macro.signatureVersion,
    },
    structureCompatibility: {
      schemaVersion: structure.schemaVersion,
      methodologyId: structure.methodologyId,
      methodologyVersion: structure.methodologyVersion,
      featureMethodologyId: structure.featureMethodologyId,
      featureMethodologyVersion: structure.featureMethodologyVersion,
      underlying: structure.underlying,
    },
    catalystCompatibility: {
      schemaVersion: "0.1.0",
    },
    macro: [macro],
    marketStructure: [structure],
    catalystEvidence: [...input.catalystArtifacts],
  };
}

function classifyFromEligibility(
  eligibility: StudyEligibility,
  invalid: boolean,
): RealArchiveSessionClassification {
  if (invalid) return "invalid";
  if (eligibility.status === "eligible") return "eligible";
  if (eligibility.status === "partial") return "partial";
  return "ineligible";
}

export function resolveRealArchiveSession(input: {
  readonly candidate: DriverCandidate;
  readonly dataRoot: string;
  readonly builtAt: string;
  readonly symbol?: string;
}): ResolvedRealArchiveSession {
  const { candidate, dataRoot, builtAt } = input;
  const sessionDate = candidate.sessionDate;
  const exclusionReasons: string[] = [];
  let invalid = false;

  const driverLoad = loadSessionDriver(sessionDate, dataRoot);
  if (!driverLoad.driver) {
    for (const issue of driverLoad.issues) {
      if (issue.severity === "missing") {
        exclusionReasons.push(exclusionMessage(EXCLUSION.MISSING_MACRO, issue.message));
      } else if (issue.severity === "mismatched") {
        exclusionReasons.push(
          exclusionMessage(EXCLUSION.MACRO_DATE_MISMATCH, issue.message),
        );
      } else if (issue.severity === "stale") {
        exclusionReasons.push(exclusionMessage(EXCLUSION.MACRO_STALE, issue.message));
      } else {
        exclusionReasons.push(exclusionMessage(EXCLUSION.MACRO_INVALID, issue.message));
        invalid = true;
      }
    }
  }

  const driver = driverLoad.driver;
  let macroArtifact: ReplayMacroArtifact | null = null;
  let macroComponent: ArchiveComponent = {
    status: "unavailable",
    kind: "macro",
    reason: exclusionReasons[0] ?? "macro unavailable",
  };

  if (driver) {
    const macroResolved = macroComponentFromDriver(
      driver,
      driverRelPath(sessionDate),
    );
    macroArtifact = macroResolved.artifact;
    macroComponent = macroResolved.macro;
    if (macroArtifact.synthetic) {
      exclusionReasons.push(exclusionMessage(EXCLUSION.MACRO_SYNTHETIC));
      macroComponent = {
        status: "unavailable",
        kind: "macro",
        reason: "macro synthetic provenance rejected",
      };
      macroArtifact = null;
    }
  }

  const structureResolution = resolveExactDateStructure({
    sessionDate,
    dataRoot,
    symbol: input.symbol,
  });
  exclusionReasons.push(...structureResolution.exclusionReasons);

  let marketStructureComponent: ArchiveComponent = {
    status: "unavailable",
    kind: "market_structure",
    reason:
      structureResolution.exclusionReasons[0] ??
      "exact-date structure unavailable",
  };

  if (structureResolution.resolved) {
    const s = structureResolution.resolved;
    if (s.artifact.synthetic) {
      exclusionReasons.push(exclusionMessage(EXCLUSION.STRUCTURE_SYNTHETIC));
      marketStructureComponent = {
        status: "unavailable",
        kind: "market_structure",
        reason: "structure synthetic provenance rejected",
      };
    } else {
      marketStructureComponent = {
        status: "available",
        kind: "market_structure",
        provenance: {
          sourceKind: "local_store",
          relativePath: s.relativePath,
          artifactId: s.artifact.artifactId,
          schemaVersion: s.artifact.schemaVersion,
          availableAt: s.artifact.availableAt,
          synthetic: false,
        },
        limitations: [...s.artifact.limitations],
        sessionDate: s.artifact.sessionDate,
        underlying: s.artifact.underlying,
        snapshotId: s.artifact.snapshotId,
      };
    }
  }

  const catalystResolution = resolvePitCatalysts({ sessionDate, dataRoot });
  exclusionReasons.push(...catalystResolution.exclusionReasons);

  let boundedComponent: ArchiveComponent = {
    status: "unavailable",
    kind: "bounded_structure",
    reason: "bounded structure not resolved for session",
  };
  if (structureResolution.boundedSnapshot) {
    boundedComponent = boundedComponentFromSnapshot(
      structureResolution.boundedSnapshot,
      structureResolution.boundedRelativePath ??
        boundedGammaRelPath(input.symbol ?? "SPY"),
    );
  }

  const evaluationInstants = defaultEvaluationInstants(sessionDate);

  const sourcesManifest = RealArchiveSessionSourcesManifest.parse({
    kind: "RealArchiveSessionSourcesManifest",
    schemaVersion: "0.1.0",
    sessionDate,
    builtAt,
    sourceKind: "local_store",
    synthetic: false,
    evaluationInstants,
    macro: macroArtifact
      ? {
          status: "resolved",
          ref: {
            sourceKind: "local_store",
            synthetic: false,
            relativePath: driverRelPath(sessionDate),
            artifactId: macroArtifact.artifactId,
            schemaVersion: macroArtifact.schemaVersion,
            availableAt: macroArtifact.availableAt,
            sessionDate: driver!.marketSessionDate,
            effectiveAsOf: sessionDate,
          },
        }
      : {
          status: "missing",
          reason: macroComponent.status === "unavailable" ? macroComponent.reason : "macro missing",
        },
    marketStructure:
      structureResolution.resolved && marketStructureComponent.status === "available"
        ? {
            status: "resolved",
            ref: {
              sourceKind: "local_store",
              synthetic: false,
              relativePath: structureResolution.resolved.relativePath,
              artifactId: structureResolution.resolved.artifact.artifactId,
              schemaVersion: structureResolution.resolved.artifact.schemaVersion,
              availableAt: structureResolution.resolved.artifact.availableAt,
              sessionDate,
              effectiveAsOf: sessionDate,
            },
            resolution: structureResolution.resolved.kind,
          }
        : {
            status: "missing",
            reason:
              marketStructureComponent.status === "unavailable"
                ? marketStructureComponent.reason
                : "structure missing",
          },
    boundedStructure:
      boundedComponent.status === "available"
        ? {
            status: "resolved",
            ref: {
              sourceKind: "local_store",
              synthetic: false,
              relativePath: boundedGammaRelPath(input.symbol ?? "SPY"),
              artifactId: boundedComponent.provenance!.artifactId,
              schemaVersion: boundedComponent.provenance!.schemaVersion,
              availableAt: boundedComponent.provenance!.availableAt,
              sessionDate,
              effectiveAsOf: sessionDate,
            },
          }
        : {
            status: "missing",
            reason:
              boundedComponent.status === "unavailable"
                ? boundedComponent.reason
                : "bounded missing",
          },
    catalystEvidence: {
      status:
        catalystResolution.artifacts.length > 0
          ? "resolved"
          : catalystResolution.pitProven
            ? "none_available"
            : "cache_unavailable",
      refs: catalystResolution.refs,
      reason:
        catalystResolution.artifacts.length === 0
          ? catalystResolution.exclusionReasons[0]
          : undefined,
    },
  });

  const components = {
    macro: macroComponent,
    marketStructure: marketStructureComponent,
    boundedStructure: boundedComponent,
    catalystEvidence: catalystResolution.components,
  };

  const eligibility = assessStudyEligibility({ sessionDate, components });
  const classification = classifyFromEligibility(eligibility, invalid);

  let corpus: ReplayCorpus | null = null;
  if (
    macroArtifact &&
    structureResolution.resolved &&
    marketStructureComponent.status === "available"
  ) {
    corpus = buildCorpusFromSession({
      driver: driver!,
      macroArtifact,
      structureArtifact: structureResolution.resolved.artifact,
      catalystArtifacts: catalystResolution.artifacts,
    });
  }

  return {
    sessionDate,
    classification,
    exclusionReasons: [...new Set(exclusionReasons)],
    sourcesManifest,
    driver,
    macroArtifact,
    components,
    corpus,
    eligibility,
    exactDateStructure: structureResolution.resolved !== null,
    catalystPitAvailable: catalystResolution.artifacts.length > 0,
  };
}

export function toInventoryEntry(
  resolved: ResolvedRealArchiveSession,
): RealArchiveInventoryEntry {
  return {
    sessionDate: resolved.sessionDate,
    classification: resolved.classification,
    exclusionReasons: resolved.exclusionReasons,
    sourcesManifest: resolved.sourcesManifest,
  };
}

export { buildMacroArtifactId };
