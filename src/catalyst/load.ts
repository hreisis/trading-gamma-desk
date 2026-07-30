import syntheticBatch from "../../fixtures/catalyst/synthetic-events.json";
import syntheticResults from "../../fixtures/catalyst/synthetic-results.json";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { Catalyst, ReleaseResult } from "@/contracts";
import { loadCalendarCache } from "./cache";
import { normalizeAndDedupe } from "./dedupe";
import { filterCatalysts } from "./query";
import { linkReleasesToCatalysts } from "./results/link";
import { loadResultsCache } from "./results/cache";
import type { BuiltRelease } from "./results/types";
import type {
  CatalystFeedResponse,
  CatalystQuery,
  CatalystRawEvent,
} from "./types";

export const CATALYST_DEMO_BANNER =
  "Illustrative catalyst demo · synthetic events";

export const CATALYST_DEMO_DISCLAIMER =
  "Synthetic catalyst fixtures for product demonstration — not actual news, calendar prints, or market observations. Synthetic release results (when shown) are illustrative — Consensus unavailable · Surprise unavailable.";

export const CATALYST_OFFICIAL_BANNER =
  "Official US macro calendar · schedules + BLS series results when linked";

export const CATALYST_OFFICIAL_DISCLAIMER =
  "BLS, BEA, and Federal Reserve schedule sources list planned release times. BLS Public Data API values are official series observations only — Consensus unavailable · Surprise unavailable. A past schedule time alone does not mark an event released.";

export const CATALYST_STALE_BANNER =
  "Official US macro calendar · stale local cache";

export const CATALYST_UNAVAILABLE_BANNER =
  "Official US macro calendar · live cache unavailable";

export const SYNTHETIC_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-events.json";

export const SYNTHETIC_RESULTS_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-results.json";

export const OFFICIAL_CALENDAR_CACHE_NAME =
  "data/catalyst/calendar-latest.json";

export const OFFICIAL_RESULTS_CACHE_NAME =
  "data/catalyst/results-latest.json";

function rawEventsFromBatch(): CatalystRawEvent[] {
  const events = (syntheticBatch as { events?: CatalystRawEvent[] }).events;
  if (!Array.isArray(events)) return [];
  return events;
}

function syntheticBuiltReleases(): BuiltRelease[] {
  const releases = (
    syntheticResults as {
      releases?: Array<{
        releaseFamily: "cpi" | "employment_situation";
        referencePeriod: string;
        observedAt: string;
        fingerprint: string;
        releaseResult: ReleaseResult;
      }>;
    }
  ).releases;
  if (!Array.isArray(releases)) return [];
  return releases.map((r) => ({
    releaseFamily: r.releaseFamily,
    referencePeriod: r.referencePeriod,
    observedAt: r.observedAt,
    fingerprint: r.fingerprint,
    observations: r.releaseResult.observations,
    releaseResult: r.releaseResult,
  }));
}

function loadSyntheticFeed(
  query: CatalystQuery,
  options: { readonly publicDemo: boolean; readonly now: Date },
): CatalystFeedResponse {
  const { catalysts, validationErrors } = normalizeAndDedupe(
    rawEventsFromBatch(),
  );
  const linked = linkReleasesToCatalysts(catalysts, syntheticBuiltReleases());
  const filtered = filterCatalysts(linked.catalysts, query);
  return {
    kind: "CatalystFeed",
    schemaVersion: "0.1.0",
    generatedAt: options.now.toISOString(),
    mode: "synthetic_demo",
    isPublicDemo: options.publicDemo,
    banner: CATALYST_DEMO_BANNER,
    disclaimer: CATALYST_DEMO_DISCLAIMER,
    source: {
      type: "fixture",
      name: SYNTHETIC_FIXTURE_NAME,
      synthetic: true,
      results: {
        available: true,
        status: "synthetic",
        fetchedAt: options.now.toISOString(),
        stale: false,
        partialFailure: false,
      },
    },
    count: filtered.length,
    catalysts: filtered,
    validationErrors,
    linkingWarnings: linked.linkingWarnings,
  };
}

function mergeOfficialResults(
  catalysts: readonly Catalyst[],
  options: { readonly dataRoot?: string; readonly now: Date },
): {
  catalysts: Catalyst[];
  linkingWarnings: CatalystFeedResponse["linkingWarnings"];
  resultsMeta: NonNullable<CatalystFeedResponse["source"]["results"]>;
} {
  const loaded = loadResultsCache({
    dataRoot: options.dataRoot,
    now: options.now,
  });
  if (!loaded.ok) {
    return {
      catalysts: [...catalysts],
      linkingWarnings: [],
      resultsMeta: {
        available: false,
        status: "missing",
        error: loaded.error,
        stale: false,
        partialFailure: false,
      },
    };
  }
  const linked = linkReleasesToCatalysts(catalysts, loaded.cache.releases);
  return {
    catalysts: linked.catalysts,
    linkingWarnings: [
      ...loaded.cache.linkingWarnings,
      ...linked.linkingWarnings,
    ],
    resultsMeta: {
      available: true,
      status: loaded.cache.sources.some((s) => s.status === "error")
        ? "error"
        : "ok",
      fetchedAt: loaded.cache.fetchedAt,
      stale: loaded.stale,
      partialFailure: loaded.cache.partialFailure,
    },
  };
}

/**
 * Catalyst feed loader.
 *
 * - Public demo: synthetic fixtures + synthetic results; never network.
 * - Local: official calendar cache + optional results cache linked strictly
 *   by releaseFamily + referencePeriod.
 */
export function loadCatalystFeed(
  query: CatalystQuery = {},
  options: {
    readonly publicDemo?: boolean;
    readonly now?: Date;
    readonly dataRoot?: string;
    /** Test-only: force synthetic path even when not in public demo. */
    readonly forceSynthetic?: boolean;
  } = {},
): CatalystFeedResponse {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  const now = options.now ?? new Date();

  if (publicDemo || options.forceSynthetic) {
    return loadSyntheticFeed(query, { publicDemo, now });
  }

  const loaded = loadCalendarCache({
    dataRoot: options.dataRoot,
    now,
  });

  if (!loaded.ok) {
    return {
      kind: "CatalystFeed",
      schemaVersion: "0.1.0",
      generatedAt: now.toISOString(),
      mode: "live_unavailable",
      isPublicDemo: false,
      banner: CATALYST_UNAVAILABLE_BANNER,
      disclaimer: `${CATALYST_OFFICIAL_DISCLAIMER} ${loaded.error}`,
      source: {
        type: "official_calendar",
        name: OFFICIAL_CALENDAR_CACHE_NAME,
        synthetic: false,
        stale: false,
        partialFailure: false,
        results: { available: false, status: "missing" },
      },
      count: 0,
      catalysts: [],
      validationErrors: [
        {
          index: -1,
          error: loaded.error,
        },
      ],
    };
  }

  const { cache, stale } = loaded;
  const merged = mergeOfficialResults(cache.catalysts, {
    dataRoot: options.dataRoot,
    now,
  });
  const filtered = filterCatalysts(merged.catalysts, query);
  const partialFailure = cache.partialFailure;

  let banner = CATALYST_OFFICIAL_BANNER;
  if (stale) banner = CATALYST_STALE_BANNER;
  if (partialFailure) {
    banner = stale
      ? `${CATALYST_STALE_BANNER} · partial source failure`
      : `${CATALYST_OFFICIAL_BANNER} · partial source failure`;
  }
  if (merged.resultsMeta.stale) {
    banner = `${banner} · stale results`;
  }

  return {
    kind: "CatalystFeed",
    schemaVersion: "0.1.0",
    generatedAt: now.toISOString(),
    mode: stale ? "stale_calendar" : "official_calendar",
    isPublicDemo: false,
    banner,
    disclaimer: CATALYST_OFFICIAL_DISCLAIMER,
    source: {
      type: "official_calendar",
      name: OFFICIAL_CALENDAR_CACHE_NAME,
      synthetic: false,
      fetchedAt: cache.fetchedAt,
      stale,
      partialFailure,
      window: cache.requestedWindow,
      sources: cache.sources,
      results: merged.resultsMeta,
    },
    count: filtered.length,
    catalysts: filtered,
    validationErrors: cache.validationErrors,
    linkingWarnings: merged.linkingWarnings,
  };
}
