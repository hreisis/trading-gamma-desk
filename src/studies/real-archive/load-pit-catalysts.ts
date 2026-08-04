import type {
  Catalyst,
  ReplayCatalystArtifact,
  ArchiveComponent,
} from "@/contracts";
import { loadCalendarCache } from "@/catalyst/cache";
import { loadResultsCache } from "@/catalyst/results/cache";
import { materializeResultsFeed } from "@/catalyst/results/link";
import {
  catalystArtifactFromCatalyst,
  ReplayCatalystAdapterError,
} from "@/replay/adapters";
import { buildCatalystArtifactId } from "@/replay/identity";
import { catalystCalendarRelPath, catalystResultsRelPath } from "./paths";
import { EXCLUSION, exclusionMessage } from "./exclusion-reasons";
import { sessionCutoffIso } from "./discover-candidates";
import type { RealArchiveComponentSourceRef } from "@/contracts/real-archive";

export function isRejectedCatalystId(id: string): boolean {
  return id.startsWith("syn-") || id.startsWith("syn_");
}

function catalystPublishedAt(catalyst: Catalyst): string | null {
  return catalyst.releaseResult?.observedAt ?? null;
}

function isPitAvailable(catalyst: Catalyst, sessionDate: string): boolean {
  if (catalyst.synthetic) return false;
  if (isRejectedCatalystId(catalyst.id)) return false;
  if (catalyst.status !== "released") return false;
  const publishedAt = catalystPublishedAt(catalyst);
  if (!publishedAt) return false;
  return publishedAt <= sessionCutoffIso(sessionDate);
}

export interface PitCatalystResolution {
  readonly artifacts: ReplayCatalystArtifact[];
  readonly components: ArchiveComponent[];
  readonly refs: RealArchiveComponentSourceRef[];
  readonly exclusionReasons: string[];
  readonly pitProven: boolean;
}

/**
 * Load catalyst evidence provably available as of sessionDate from local caches.
 * Rejects syn-* IDs and synthetic catalysts. Does not backfill future releases.
 */
export function resolvePitCatalysts(input: {
  readonly sessionDate: string;
  readonly dataRoot: string;
  readonly now?: Date;
}): PitCatalystResolution {
  const exclusionReasons: string[] = [];
  const calendarLoaded = loadCalendarCache({
    dataRoot: input.dataRoot,
    now: input.now,
  });
  const resultsLoaded = loadResultsCache({
    dataRoot: input.dataRoot,
    now: input.now,
  });

  if (!calendarLoaded.ok) {
    exclusionReasons.push(
      exclusionMessage(
        EXCLUSION.CATALYST_CACHE_UNAVAILABLE,
        calendarLoaded.error,
      ),
    );
    return {
      artifacts: [],
      components: [],
      refs: [],
      exclusionReasons,
      pitProven: false,
    };
  }

  const linked = materializeResultsFeed({
    scheduled: calendarLoaded.cache.catalysts,
    releases: resultsLoaded.ok ? resultsLoaded.cache.releases : [],
    calendarAvailable: true,
    calendarUnavailableReason: resultsLoaded.ok
      ? undefined
      : resultsLoaded.error,
  });

  const pitCatalysts = linked.catalysts.filter((c) =>
    isPitAvailable(c, input.sessionDate),
  );

  for (const c of linked.catalysts) {
    if (isRejectedCatalystId(c.id)) {
      exclusionReasons.push(
        exclusionMessage(EXCLUSION.CATALYST_SYN_ID, c.id),
      );
    } else if (c.synthetic) {
      exclusionReasons.push(
        exclusionMessage(EXCLUSION.CATALYST_SYNTHETIC, c.id),
      );
    }
  }

  const artifacts: ReplayCatalystArtifact[] = [];
  const components: ArchiveComponent[] = [];
  const refs: RealArchiveComponentSourceRef[] = [];

  for (const catalyst of pitCatalysts) {
    try {
      const artifact = catalystArtifactFromCatalyst(catalyst);
      artifacts.push(artifact);
      refs.push({
        sourceKind: "local_store",
        synthetic: false,
        relativePath: catalystCalendarRelPath(),
        artifactId: artifact.artifactId,
        schemaVersion: artifact.schemaVersion,
        availableAt: artifact.publishedAt,
        effectiveAsOf: input.sessionDate,
      });
      components.push({
        status: "available",
        kind: "catalyst_evidence",
        provenance: {
          sourceKind: "local_store",
          relativePath: catalystCalendarRelPath(),
          artifactId: artifact.artifactId,
          schemaVersion: artifact.schemaVersion,
          availableAt: artifact.publishedAt,
          synthetic: false,
        },
        limitations: [...artifact.limitations],
        catalystId: artifact.catalystId,
      });
    } catch (error) {
      if (error instanceof ReplayCatalystAdapterError) {
        exclusionReasons.push(error.message);
      } else {
        throw error;
      }
    }
  }

  if (
    calendarLoaded.cache.fetchedAt > sessionCutoffIso(input.sessionDate) &&
    pitCatalysts.length === 0
  ) {
    exclusionReasons.push(
      exclusionMessage(
        EXCLUSION.CATALYST_PIT_UNPROVEN,
        `calendar fetchedAt ${calendarLoaded.cache.fetchedAt} after session cutoff`,
      ),
    );
  }

  return {
    artifacts,
    components,
    refs,
    exclusionReasons,
    pitProven: pitCatalysts.length > 0 || calendarLoaded.ok,
  };
}

export function catalystRefsFromArtifacts(
  artifacts: readonly ReplayCatalystArtifact[],
  sessionDate: string,
): RealArchiveComponentSourceRef[] {
  return artifacts.map((a) => ({
    sourceKind: "local_store" as const,
    synthetic: false as const,
    relativePath: catalystCalendarRelPath(),
    artifactId: a.artifactId,
    schemaVersion: a.schemaVersion,
    availableAt: a.publishedAt,
    effectiveAsOf: sessionDate,
  }));
}

/** Exported for tests — detect syn-* in artifact IDs. */
export function isSyntheticCatalystArtifactId(artifactId: string): boolean {
  const catalystId = artifactId.replace(/^catalyst\|/, "");
  return isRejectedCatalystId(catalystId);
}

export { buildCatalystArtifactId };
