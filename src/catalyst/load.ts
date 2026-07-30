import syntheticBatch from "../../fixtures/catalyst/synthetic-events.json";
import syntheticResults from "../../fixtures/catalyst/synthetic-results.json";
import syntheticDocuments from "../../fixtures/catalyst/synthetic-documents.json";
import syntheticAiBriefs from "../../fixtures/catalyst/synthetic-ai-briefs.json";
import { isPublicDemoMode } from "@/desk/public-demo";
import type {
  Catalyst,
  OfficialAiBrief,
  OfficialBrief,
  OfficialDocument,
  ReleaseResult,
} from "@/contracts";
import {
  OfficialAiBrief as OfficialAiBriefSchema,
  OfficialDocument as OfficialDocumentSchema,
} from "@/contracts";
import { loadAiBriefsCache } from "./briefs/ai/cache";
import { applyStructuredCrossCheck, indexStructuredReleases } from "./briefs/cross-check";
import { extractBriefFromDocument } from "./briefs/extract";
import { loadBriefsCache } from "./briefs/cache";
import {
  filterBriefsForFeed,
  publishedAtMapFromDocuments,
} from "./briefs/materialize";
import { BRIEF_EXTRACTOR_VERSION } from "./briefs/version";
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
  "Synthetic catalyst fixtures for product demonstration — not actual news, calendar prints, or market observations. Synthetic release results, documents, rule-based briefs, and Demo AI briefs (when shown) are illustrative — Consensus unavailable · Surprise unavailable. AI briefs are narratives over cited synthetic facts, not live LLM calls.";

export const CATALYST_OFFICIAL_BANNER =
  "Official US macro calendar · schedules + BLS series results when linked";

export const CATALYST_OFFICIAL_DISCLAIMER =
  "BLS, BEA, and Federal Reserve schedule sources list planned release times. BLS Public Data API values are official series observations only — Consensus unavailable · Surprise unavailable. Rule-based briefs are fact extracts with evidence offsets. AI briefs rewrite only those cited facts — not official prose; rejected/unavailable AI falls back to rule-based facts. Unextracted ≠ agency omitted. A past schedule time alone does not mark an event released.";

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

export const OFFICIAL_BRIEFS_CACHE_NAME = "data/catalyst/briefs-latest.json";

export const OFFICIAL_AI_BRIEFS_CACHE_NAME =
  "data/catalyst/ai-briefs-latest.json";

export const SYNTHETIC_DOCUMENTS_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-documents.json";

export const SYNTHETIC_AI_BRIEFS_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-ai-briefs.json";

function syntheticOfficialAiBriefs(): OfficialAiBrief[] {
  const briefs = (syntheticAiBriefs as { briefs?: unknown[] }).briefs;
  if (!Array.isArray(briefs)) return [];
  const out: OfficialAiBrief[] = [];
  for (const b of briefs) {
    const parsed = OfficialAiBriefSchema.safeParse(b);
    if (parsed.success && parsed.data.synthetic) out.push(parsed.data);
  }
  return out;
}

function filterAiBriefsForFeed(
  aiBriefs: readonly OfficialAiBrief[],
  deterministic: readonly OfficialBrief[],
): OfficialAiBrief[] {
  const byId = new Map(deterministic.map((b) => [b.id, b]));
  return aiBriefs.filter((b) => {
    const det = byId.get(b.inputBriefId);
    if (!det) return false;
    if (b.status !== "complete" && b.status !== "partial") return false;
    if (b.validation.errors.length > 0) return false;
    // Stale grounding: reject AI briefs that no longer match the deterministic layer.
    if (b.documentContentHash !== det.documentContentHash) return false;
    if (b.extractorVersion !== det.extractorVersion) return false;
    return true;
  });
}

function slimDocumentForFeed(doc: OfficialDocument): OfficialDocument {
  const { contentText: _body, ...rest } = doc;
  return rest;
}

function buildBriefsFromDocuments(
  documents: readonly OfficialDocument[],
  structured: readonly BuiltRelease[],
  now: Date,
): OfficialBrief[] {
  const index = indexStructuredReleases(structured);
  const generatedAt = now.toISOString();
  return documents.map((doc) =>
    applyStructuredCrossCheck(
      extractBriefFromDocument(doc, generatedAt),
      index,
    ),
  );
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
  const synDocs = syntheticOfficialDocuments();
  const withDocs = applyDocuments(linked.catalysts, synDocs, options.now);
  const archiveBriefs = buildBriefsFromDocuments(
    synDocs,
    syntheticBuiltReleases(),
    options.now,
  );
  const feedBriefs = filterBriefsForFeed(
    archiveBriefs,
    publishedAtMapFromDocuments(synDocs),
    options.now,
    30,
  );
  const synAi = syntheticOfficialAiBriefs();
  const feedAi = filterAiBriefsForFeed(synAi, feedBriefs);
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
      briefs: {
        available: true,
        status: "synthetic",
        fetchedAt: options.now.toISOString(),
        stale: false,
        archiveBriefCount: archiveBriefs.length,
        feedBriefCount: feedBriefs.length,
        extractorVersion: BRIEF_EXTRACTOR_VERSION,
      },
      aiBriefs: {
        available: true,
        status: "synthetic",
        fetchedAt: options.now.toISOString(),
        stale: false,
        archiveBriefCount: synAi.length,
        feedBriefCount: feedAi.length,
        model: "synthetic",
      },
    },
    count: filtered.length,
    catalysts: filtered,
    documents: withDocs.documents,
    briefs: feedBriefs,
    aiBriefs: feedAi,
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
  const briefsLoaded = loadBriefsCache({
    dataRoot: options.dataRoot,
    now,
  });
  const aiBriefsLoaded = loadAiBriefsCache({
    dataRoot: options.dataRoot,
    now,
  });

  function resolveFeedBriefs(
    archiveDocs: readonly OfficialDocument[] | undefined,
  ): {
    briefs: OfficialBrief[] | undefined;
    meta: NonNullable<CatalystFeedResponse["source"]["briefs"]>;
  } {
    if (!briefsLoaded.ok) {
      return {
        briefs: undefined,
        meta: {
          available: false,
          status: "missing",
          error: briefsLoaded.error,
        },
      };
    }
    const published = archiveDocs?.length
      ? publishedAtMapFromDocuments(archiveDocs)
      : new Map(
          briefsLoaded.cache.inputDocuments.map((d) => [
            d.documentId,
            d.publishedAt,
          ]),
        );
    const feed = filterBriefsForFeed(
      briefsLoaded.cache.briefs,
      published,
      now,
      30,
    );
    return {
      briefs: feed,
      meta: {
        available: true,
        status: briefsLoaded.cache.buildStatus,
        fetchedAt: briefsLoaded.cache.generatedAt,
        stale: briefsLoaded.stale,
        archiveBriefCount: briefsLoaded.cache.briefs.length,
        feedBriefCount: feed.length,
        extractorVersion: briefsLoaded.cache.extractorVersion,
      },
    };
  }

  function resolveFeedAiBriefs(
    deterministic: readonly OfficialBrief[] | undefined,
  ): {
    aiBriefs: OfficialAiBrief[] | undefined;
    meta: NonNullable<CatalystFeedResponse["source"]["aiBriefs"]>;
  } {
    if (!aiBriefsLoaded.ok) {
      return {
        aiBriefs: undefined,
        meta: {
          available: false,
          status: "missing",
          error: aiBriefsLoaded.error,
        },
      };
    }
    const feed = filterAiBriefsForFeed(
      aiBriefsLoaded.cache.briefs,
      deterministic ?? [],
    );
    return {
      aiBriefs: feed,
      meta: {
        available: true,
        status: aiBriefsLoaded.cache.buildStatus,
        fetchedAt: aiBriefsLoaded.cache.generatedAt,
        stale: aiBriefsLoaded.stale,
        archiveBriefCount: aiBriefsLoaded.cache.briefs.length,
        feedBriefCount: feed.length,
        promptVersion: aiBriefsLoaded.cache.promptVersion,
        model: aiBriefsLoaded.cache.model,
      },
    };
  }

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
      const briefPack = resolveFeedBriefs(
        documentsLoaded.ok ? documentsLoaded.cache.documents : undefined,
      );
      const aiPack = resolveFeedAiBriefs(briefPack.briefs);
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
          briefs: briefPack.meta,
          aiBriefs: aiPack.meta,
        },
        count: filtered.length,
        catalysts: filtered,
        documents: withDocs?.documents,
        briefs: briefPack.briefs,
        aiBriefs: aiPack.aiBriefs,
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

  const briefPack = resolveFeedBriefs(
    documentsLoaded.ok ? documentsLoaded.cache.documents : undefined,
  );
  const aiPack = resolveFeedAiBriefs(briefPack.briefs);

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
  if (briefPack.meta.stale) {
    banner = `${banner} · stale briefs`;
  }
  if (aiPack.meta.stale) {
    banner = `${banner} · stale AI briefs`;
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
      briefs: briefPack.meta,
      aiBriefs: aiPack.meta,
    },
    count: filtered.length,
    catalysts: filtered,
    documents: feedDocuments,
    briefs: briefPack.briefs,
    aiBriefs: aiPack.aiBriefs,
    validationErrors: cache.validationErrors,
    linkingWarnings,
    documentLinkingWarnings,
  };
}
