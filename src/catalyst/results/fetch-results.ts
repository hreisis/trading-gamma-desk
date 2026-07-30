import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { FetchLike } from "@/ingest/http";
import { loadCalendarCache } from "../cache";
import { linkReleasesToCatalysts } from "./link";
import { buildReleasesFromSeries, observationFingerprint } from "./build";
import { fetchBlsSeriesData } from "./bls-api";
import {
  BLS_RESULTS_API_URL,
  BLS_RESULTS_SOURCE_NAME,
  BLS_SERIES_REGISTRY,
} from "./registry";
import { loadResultsCache } from "./cache";
import {
  DEFAULT_RESULTS_DATA_ROOT,
  resultsLatestPath,
} from "./paths";
import type {
  BuiltRelease,
  CatalystResultsCache,
  ReleaseRevisionRecord,
  ResultsSeriesMetadata,
} from "./types";

export {
  DEFAULT_RESULTS_DATA_ROOT,
  RESULTS_LATEST_RELATIVE,
  resultsLatestPath,
} from "./paths";

export interface FetchOfficialResultsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  /** Optional calendar root for linking diagnostics at fetch time. */
  readonly calendarDataRoot?: string;
}

export interface FetchOfficialResultsResult {
  readonly cache: CatalystResultsCache;
  readonly path: string | null;
}

function detectRevisions(
  previous: readonly BuiltRelease[] | undefined,
  next: readonly BuiltRelease[],
): ReleaseRevisionRecord[] {
  if (!previous || previous.length === 0) return [];
  const prevMap = new Map(
    previous.map((r) => [`${r.releaseFamily}|${r.referencePeriod}`, r]),
  );
  const revisions: ReleaseRevisionRecord[] = [];
  for (const cur of next) {
    const key = `${cur.releaseFamily}|${cur.referencePeriod}`;
    const old = prevMap.get(key);
    if (!old) continue;
    if (old.fingerprint === cur.fingerprint) continue;
    revisions.push({
      releaseFamily: cur.releaseFamily,
      referencePeriod: cur.referencePeriod,
      observedAt: cur.observedAt,
      previousFingerprint: old.fingerprint,
      currentFingerprint: cur.fingerprint,
      previousObservations: [...old.observations],
      currentObservations: [...cur.observations],
    });
  }
  return revisions;
}

function seriesMetadataFrom(
  series: Awaited<ReturnType<typeof fetchBlsSeriesData>>["series"],
): ResultsSeriesMetadata[] {
  const byId = new Map(series.map((s) => [s.seriesId, s]));
  const seen = new Set<string>();
  const out: ResultsSeriesMetadata[] = [];
  for (const spec of BLS_SERIES_REGISTRY) {
    if (seen.has(spec.levelSeriesId)) continue;
    seen.add(spec.levelSeriesId);
    const data = byId.get(spec.levelSeriesId);
    const latest = data?.points[data.points.length - 1]?.referencePeriod ?? null;
    out.push({
      seriesId: spec.levelSeriesId,
      releaseFamily: spec.releaseFamily,
      seasonalAdjustment: spec.seasonalAdjustment,
      description: spec.description,
      pointCount: data?.points.length ?? 0,
      latestReferencePeriod: latest,
    });
  }
  return out;
}

/**
 * Fetch BLS series results, build release observations, atomically write
 * `data/catalyst/results-latest.json`. Does not modify the calendar cache.
 * Public demo must never call this path.
 */
export async function fetchOfficialResults(
  options: FetchOfficialResultsOptions = {},
): Promise<FetchOfficialResultsResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Official results fetch is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic result fixtures only and must not call BLS.",
    );
  }

  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_RESULTS_DATA_ROOT;

  const prior = loadResultsCache({ dataRoot, now });
  const priorReleases = prior.ok ? prior.cache.releases : undefined;

  const fetched = await fetchBlsSeriesData({
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    now,
  });

  if (fetched.status === "error") {
    const cache: CatalystResultsCache = {
      kind: "CatalystResultsCache",
      schemaVersion: "0.1.0",
      fetchedAt: observedAt,
      sources: [
        {
          id: "bls_api",
          name: BLS_RESULTS_SOURCE_NAME,
          url: fetched.url || BLS_RESULTS_API_URL,
          status: "error",
          error: fetched.error,
        },
      ],
      seriesMetadata: [],
      releases: [],
      revisions: [],
      validationErrors: [
        { error: fetched.error ?? "BLS results fetch failed" },
      ],
      linkingWarnings: [],
      partialFailure: true,
    };
    // Never overwrite a prior good cache on total failure.
    return { cache, path: null };
  }

  const built = buildReleasesFromSeries(fetched.series, observedAt);
  const revisions = detectRevisions(priorReleases, built.releases);

  // Carry forward prior revision history (capped) plus new ones.
  const priorRevisionHistory = prior.ok ? prior.cache.revisions : [];
  const allRevisions = [...revisions, ...priorRevisionHistory].slice(0, 100);

  let linkingWarnings: CatalystResultsCache["linkingWarnings"] = [];
  const calendarRoot = options.calendarDataRoot ?? dataRoot;
  const calendar = loadCalendarCache({ dataRoot: calendarRoot, now });
  if (calendar.ok) {
    const linked = linkReleasesToCatalysts(
      calendar.cache.catalysts,
      built.releases,
    );
    linkingWarnings = linked.linkingWarnings;
  } else {
    linkingWarnings = [
      {
        error: `Calendar cache unavailable for linking diagnostics: ${calendar.error}`,
      },
    ];
  }

  const cache: CatalystResultsCache = {
    kind: "CatalystResultsCache",
    schemaVersion: "0.1.0",
    fetchedAt: observedAt,
    sources: [
      {
        id: "bls_api",
        name: BLS_RESULTS_SOURCE_NAME,
        url: fetched.url,
        status: "ok",
        seriesCount: fetched.series.length,
      },
    ],
    seriesMetadata: seriesMetadataFrom(fetched.series),
    releases: built.releases,
    revisions: allRevisions,
    validationErrors: built.validationErrors,
    linkingWarnings,
    partialFailure: false,
  };

  let path: string | null = null;
  if (options.write !== false) {
    path = resultsLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  }

  return { cache, path };
}

export { observationFingerprint };
