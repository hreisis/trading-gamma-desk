import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { FetchLike } from "@/ingest/http";
import { loadCalendarCache } from "../cache";
import { mergeDocumentArchives } from "./build";
import { loadDocumentsCache } from "./cache";
import {
  filterDocumentsForFeed,
  linkDocumentsToCatalysts,
} from "./link";
import {
  DEFAULT_DOCUMENTS_DATA_ROOT,
  documentsLatestPath,
} from "./paths";
import {
  fetchBeaDocuments,
  fetchBlsDocuments,
  fetchFedDocuments,
} from "./providers";
import type {
  CatalystDocumentsCache,
  DocumentRevisionRecord,
} from "./types";

export {
  DEFAULT_DOCUMENTS_DATA_ROOT,
  DOCUMENTS_LATEST_RELATIVE,
  documentsLatestPath,
} from "./paths";

export const DOCUMENTS_FEED_DAYS = 30;

export interface FetchOfficialDocumentsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly fetchBodies?: boolean;
  readonly calendarDataRoot?: string;
}

export interface FetchOfficialDocumentsResult {
  readonly cache: CatalystDocumentsCache;
  readonly path: string | null;
}

function detectDocumentRevisions(
  previous: CatalystDocumentsCache["documents"] | undefined,
  next: CatalystDocumentsCache["documents"],
): DocumentRevisionRecord[] {
  if (!previous || previous.length === 0) return [];
  const prevMap = new Map(previous.map((d) => [d.canonicalUrl, d]));
  const revisions: DocumentRevisionRecord[] = [];
  for (const cur of next) {
    const old = prevMap.get(cur.canonicalUrl);
    if (!old) continue;
    if (old.contentHash === cur.contentHash) continue;
    revisions.push({
      canonicalUrl: cur.canonicalUrl,
      documentId: cur.id,
      observedAt: cur.observedAt,
      previousContentHash: old.contentHash,
      currentContentHash: cur.contentHash,
      title: cur.title,
    });
  }
  return revisions;
}

/**
 * Fetch Fed / BLS / BEA official release documents into
 * `data/catalyst/documents-latest.json`. Independent of calendar/results caches.
 * Public demo must never call this path.
 */
export async function fetchOfficialDocuments(
  options: FetchOfficialDocumentsOptions = {},
): Promise<FetchOfficialDocumentsResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Official document fetch is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic document fixtures only and must not call Fed/BLS/BEA.",
    );
  }

  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_DOCUMENTS_DATA_ROOT;
  const prior = loadDocumentsCache({ dataRoot, now });

  const providerResults = await Promise.all([
    fetchFedDocuments({
      observedAt,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      fetchBodies: options.fetchBodies,
    }),
    fetchBlsDocuments({
      observedAt,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      fetchBodies: options.fetchBodies,
    }),
    fetchBeaDocuments({
      observedAt,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      fetchBodies: options.fetchBodies,
    }),
  ]);

  const sources = providerResults.map((r) => r.source);
  const partialFailure = sources.some((s) => s.status === "error");
  const allFailed = sources.every((s) => s.status === "error");

  const fetchedDocs = providerResults.flatMap((r) => r.documents);
  const validationErrors = providerResults.flatMap((r) => r.validationErrors);

  const documents = mergeDocumentArchives(
    prior.ok ? prior.cache.documents : undefined,
    fetchedDocs,
  );
  const revisions = detectDocumentRevisions(
    prior.ok ? prior.cache.documents : undefined,
    documents,
  );

  // Linking diagnostics against calendar when available (does not write calendar).
  const calendar = loadCalendarCache({
    dataRoot: options.calendarDataRoot ?? dataRoot,
    now,
  });
  const feedDocs = filterDocumentsForFeed(documents, now, DOCUMENTS_FEED_DAYS);
  const linkResult = calendar.ok
    ? linkDocumentsToCatalysts(calendar.cache.catalysts, feedDocs)
    : {
        catalysts: [],
        linkingWarnings: [],
        linkedCount: 0,
        unmatchedCount: feedDocs.length,
      };

  const feedStart = new Date(
    now.getTime() - DOCUMENTS_FEED_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const cache: CatalystDocumentsCache = {
    kind: "CatalystDocumentsCache",
    schemaVersion: "0.1.0",
    fetchedAt: observedAt,
    requestedWindow: {
      now: observedAt,
      feedStart,
      feedEnd: observedAt,
    },
    sources,
    documents,
    revisions: [
      ...(prior.ok ? prior.cache.revisions : []),
      ...revisions,
    ].slice(-200),
    validationErrors,
    linkingWarnings: linkResult.linkingWarnings,
    partialFailure,
  };

  const shouldWrite = options.write !== false && !allFailed;
  let path: string | null = null;
  if (shouldWrite) {
    path = documentsLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  }

  return { cache, path };
}
