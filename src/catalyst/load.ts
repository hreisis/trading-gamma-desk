import syntheticBatch from "../../fixtures/catalyst/synthetic-events.json";
import syntheticResults from "../../fixtures/catalyst/synthetic-results.json";
import syntheticDocuments from "../../fixtures/catalyst/synthetic-documents.json";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { Catalyst, OfficialDocument, ReleaseResult } from "@/contracts";
import { OfficialDocument as OfficialDocumentSchema } from "@/contracts";
import { loadCalendarCache } from "./cache";
import { normalizeAndDedupe } from "./dedupe";
import { filterCatalysts } from "./query";
import { loadDocumentsCache } from "./documents/cache";
import {
  filterDocumentsForFeed,
  linkDocumentsToCatalysts,
} from "./documents/link";
import { materializeResultsFeed } from "./results/link";
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
  "Synthetic catalyst fixtures for product demonstration — not actual news, calendar prints, or market observations. Synthetic release results and official-document fixtures (when shown) are illustrative — Consensus unavailable · Surprise unavailable. No AI document summaries.";

export const CATALYST_OFFICIAL_BANNER =
  "Official US macro calendar · schedules + BLS series results when linked";

export const CATALYST_OFFICIAL_DISCLAIMER =
  "BLS, BEA, and Federal Reserve schedule sources list planned release times. BLS Public Data API values are official series observations only — Consensus unavailable · Surprise unavailable. Official release documents (when linked) are source text/evidence only — no AI summaries. A past schedule time alone does not mark an event released. Default feed shows scheduled events plus at most the latest observation per release family.";

export const CATALYST_STALE_BANNER =
  "Official US macro calendar · stale local cache";

export const CATALYST_UNAVAILABLE_BANNER =
  "Official US macro calendar · live cache unavailable";

export const CATALYST_RESULTS_ONLY_BANNER =
  "Official BLS results · calendar cache unavailable";

export const SYNTHETIC_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-events.json";

export const SYNTHETIC_RESULTS_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-results.json";

export const OFFICIAL_CALENDAR_CACHE_NAME =
  "data/catalyst/calendar-latest.json";

export const OFFICIAL_RESULTS_CACHE_NAME =
  "data/catalyst/results-latest.json";

export const OFFICIAL_DOCUMENTS_CACHE_NAME =
  "data/catalyst/documents-latest.json";

export const SYNTHETIC_DOCUMENTS_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-documents.json";

function slimDocumentForFeed(doc: OfficialDocument): OfficialDocument {
  const { contentText: _body, ...rest } = doc;
  return rest;
}

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

function syntheticOfficialDocuments(): OfficialDocument[] {
  const docs = (syntheticDocuments as { documents?: unknown[] }).documents;
  if (!Array.isArray(docs)) return [];
  const out: OfficialDocument[] = [];
  for (const d of docs) {
    const parsed = OfficialDocumentSchema.safeParse(d);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function applyDocuments(
  catalysts: Catalyst[],
  archive: readonly OfficialDocument[],
  now: Date,
): {
  catalysts: Catalyst[];
  documents: OfficialDocument[];
  documentLinkingWarnings: NonNullable<
    CatalystFeedResponse["documentLinkingWarnings"]
  >;
  linkedCount: number;
  archiveDocumentCount: number;
} {
  const feedDocs = filterDocumentsForFeed(archive, now, 30);
  const linked = linkDocumentsToCatalysts(catalysts, feedDocs);
  return {
    catalysts: linked.catalysts,
    documents: feedDocs.map(slimDocumentForFeed),
    documentLinkingWarnings: linked.linkingWarnings,
    linkedCount: linked.linkedCount,
    archiveDocumentCount: archive.length,
  };
}

function loadSyntheticFeed(
  query: CatalystQuery,
  options: { readonly publicDemo: boolean; readonly now: Date },
): CatalystFeedResponse {
  const { catalysts, validationErrors } = normalizeAndDedupe(
    rawEventsFromBatch(),
  );
  const linked = materializeResultsFeed({
    scheduled: catalysts,
    releases: syntheticBuiltReleases(),
    calendarAvailable: true,
  });
  const withDocs = applyDocuments(
    linked.catalysts,
    syntheticOfficialDocuments(),
    options.now,
  );
  const filtered = filterCatalysts(withDocs.catalysts, query);
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
        archiveReleaseCount: linked.archiveReleaseCount,
        materializedStandaloneCount: linked.materializedStandaloneCount,
        linkedCount: linked.linkedCount,
      },
      documents: {
        available: true,
        status: "synthetic",
        fetchedAt: options.now.toISOString(),
        stale: false,
        partialFailure: false,
        archiveDocumentCount: withDocs.archiveDocumentCount,
        feedDocumentCount: withDocs.documents.length,
        linkedCount: withDocs.linkedCount,
      },
    },
    count: filtered.length,
    catalysts: filtered,
    documents: withDocs.documents,
    validationErrors,
    linkingWarnings: linked.linkingWarnings,
    documentLinkingWarnings: withDocs.documentLinkingWarnings,
  };
}

function resultsMetaFromMaterialize(
  loaded: Extract<ReturnType<typeof loadResultsCache>, { ok: true }>,
  linked: ReturnType<typeof materializeResultsFeed>,
): NonNullable<CatalystFeedResponse["source"]["results"]> {
  return {
    available: true,
    status: loaded.cache.sources.some((s) => s.status === "error")
      ? "error"
      : "ok",
    fetchedAt: loaded.cache.fetchedAt,
    stale: loaded.stale,
    partialFailure: loaded.cache.partialFailure,
    archiveReleaseCount: linked.archiveReleaseCount,
    materializedStandaloneCount: linked.materializedStandaloneCount,
    linkedCount: linked.linkedCount,
  };
}

/**
 * Catalyst feed loader.
 *
 * - Public demo: synthetic fixtures + synthetic results; never network.
 * - Local: official calendar + results archive; default feed materializes
 *   scheduled events (linked when possible) and ≤1 latest observation per family.
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
  const resultsLoaded = loadResultsCache({
    dataRoot: options.dataRoot,
    now,
  });
  const documentsLoaded = loadDocumentsCache({
    dataRoot: options.dataRoot,
    now,
  });

  if (!loaded.ok) {
    // Calendar unavailable: still surface latest CPI/Employment observations.
    if (resultsLoaded.ok) {
      const linked = materializeResultsFeed({
        scheduled: [],
        releases: resultsLoaded.cache.releases,
        calendarAvailable: false,
        calendarUnavailableReason: loaded.error,
      });
      const withDocs = documentsLoaded.ok
        ? applyDocuments(linked.catalysts, documentsLoaded.cache.documents, now)
        : null;
      const catalysts = withDocs?.catalysts ?? linked.catalysts;
      const filtered = filterCatalysts(catalysts, query);
      return {
        kind: "CatalystFeed",
        schemaVersion: "0.1.0",
        generatedAt: now.toISOString(),
        mode: "official_calendar",
        isPublicDemo: false,
        banner: CATALYST_RESULTS_ONLY_BANNER,
        disclaimer: `${CATALYST_OFFICIAL_DISCLAIMER} ${loaded.error}`,
        source: {
          type: "official_calendar",
          name: OFFICIAL_RESULTS_CACHE_NAME,
          synthetic: false,
          stale: resultsLoaded.stale,
          partialFailure: resultsLoaded.cache.partialFailure,
          results: resultsMetaFromMaterialize(resultsLoaded, linked),
          documents: documentsLoaded.ok
            ? {
                available: true,
                status: "ok",
                fetchedAt: documentsLoaded.cache.fetchedAt,
                stale: documentsLoaded.stale,
                partialFailure: documentsLoaded.cache.partialFailure,
                archiveDocumentCount: withDocs?.archiveDocumentCount,
                feedDocumentCount: withDocs?.documents.length,
                linkedCount: withDocs?.linkedCount,
                sources: documentsLoaded.cache.sources,
              }
            : { available: false, status: "missing", error: documentsLoaded.error },
        },
        count: filtered.length,
        catalysts: filtered,
        documents: withDocs?.documents,
        validationErrors: [
          { index: -1, error: loaded.error },
        ],
        linkingWarnings: linked.linkingWarnings,
        documentLinkingWarnings: withDocs?.documentLinkingWarnings,
      };
    }

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
        documents: documentsLoaded.ok
          ? {
              available: true,
              status: "ok",
              fetchedAt: documentsLoaded.cache.fetchedAt,
              stale: documentsLoaded.stale,
              partialFailure: documentsLoaded.cache.partialFailure,
              archiveDocumentCount: documentsLoaded.cache.documents.length,
              feedDocumentCount: filterDocumentsForFeed(
                documentsLoaded.cache.documents,
                now,
                30,
              ).length,
              sources: documentsLoaded.cache.sources,
            }
          : { available: false, status: "missing", error: documentsLoaded.error },
      },
      count: 0,
      catalysts: [],
      documents: documentsLoaded.ok
        ? filterDocumentsForFeed(documentsLoaded.cache.documents, now, 30).map(
            slimDocumentForFeed,
          )
        : undefined,
      validationErrors: [
        {
          index: -1,
          error: loaded.error,
        },
      ],
    };
  }

  const { cache, stale } = loaded;
  let catalysts: Catalyst[] = [...cache.catalysts];
  let linkingWarnings: CatalystFeedResponse["linkingWarnings"] = [];
  let resultsMeta: NonNullable<CatalystFeedResponse["source"]["results"]> = {
    available: false,
    status: "missing",
  };

  if (resultsLoaded.ok) {
    const linked = materializeResultsFeed({
      scheduled: cache.catalysts,
      releases: resultsLoaded.cache.releases,
      calendarAvailable: true,
    });
    catalysts = linked.catalysts;
    linkingWarnings = linked.linkingWarnings;
    resultsMeta = resultsMetaFromMaterialize(resultsLoaded, linked);
  }

  let documentsMeta: NonNullable<CatalystFeedResponse["source"]["documents"]> = {
    available: false,
    status: "missing",
  };
  let feedDocuments: OfficialDocument[] | undefined;
  let documentLinkingWarnings: CatalystFeedResponse["documentLinkingWarnings"];

  if (documentsLoaded.ok) {
    const withDocs = applyDocuments(
      catalysts,
      documentsLoaded.cache.documents,
      now,
    );
    catalysts = withDocs.catalysts;
    feedDocuments = withDocs.documents;
    documentLinkingWarnings = withDocs.documentLinkingWarnings;
    documentsMeta = {
      available: true,
      status: documentsLoaded.cache.sources.some((s) => s.status === "error")
        ? "error"
        : "ok",
      fetchedAt: documentsLoaded.cache.fetchedAt,
      stale: documentsLoaded.stale,
      partialFailure: documentsLoaded.cache.partialFailure,
      archiveDocumentCount: withDocs.archiveDocumentCount,
      feedDocumentCount: withDocs.documents.length,
      linkedCount: withDocs.linkedCount,
      sources: documentsLoaded.cache.sources,
    };
  } else {
    documentsMeta = {
      available: false,
      status: "missing",
      error: documentsLoaded.error,
    };
  }

  const filtered = filterCatalysts(catalysts, query);
  const partialFailure = cache.partialFailure;

  let banner = CATALYST_OFFICIAL_BANNER;
  if (stale) banner = CATALYST_STALE_BANNER;
  if (partialFailure) {
    banner = stale
      ? `${CATALYST_STALE_BANNER} · partial source failure`
      : `${CATALYST_OFFICIAL_BANNER} · partial source failure`;
  }
  if (resultsMeta.stale) {
    banner = `${banner} · stale results`;
  }
  if (documentsMeta.stale) {
    banner = `${banner} · stale documents`;
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
      results: resultsMeta,
      documents: documentsMeta,
    },
    count: filtered.length,
    catalysts: filtered,
    documents: feedDocuments,
    validationErrors: cache.validationErrors,
    linkingWarnings,
    documentLinkingWarnings,
  };
}
