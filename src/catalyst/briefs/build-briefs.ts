import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { OfficialBrief, OfficialDocument } from "@/contracts";
import { loadDocumentsCache } from "../documents/cache";
import { loadResultsCache } from "../results/cache";
import { applyStructuredCrossCheck, indexStructuredReleases } from "./cross-check";
import { extractBriefFromDocument } from "./extract";
import { loadBriefsCache } from "./cache";
import {
  DEFAULT_BRIEFS_DATA_ROOT,
  briefsLatestPath,
} from "./paths";
import type {
  BriefBuildError,
  BriefInputDocumentRef,
  BriefRevisionRecord,
  CatalystBriefsCache,
} from "./types";
import { BRIEF_EXTRACTOR_VERSION } from "./version";
import { briefIdFor } from "./extract-common";

export {
  DEFAULT_BRIEFS_DATA_ROOT,
  BRIEFS_LATEST_RELATIVE,
  briefsLatestPath,
} from "./paths";

export const BRIEFS_FEED_DAYS = 30;

export interface BuildOfficialBriefsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly documentsDataRoot?: string;
  readonly resultsDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  /** Test injection: documents instead of cache. */
  readonly documents?: readonly OfficialDocument[];
  /** Test injection: structured releases. */
  readonly structuredReleases?: readonly {
    readonly releaseFamily: string;
    readonly referencePeriod: string;
    readonly releaseResult: import("@/contracts").ReleaseResult;
  }[];
}

export interface BuildOfficialBriefsResult {
  readonly cache: CatalystBriefsCache;
  readonly path: string | null;
}

/**
 * Build evidence-grounded briefs from local documents cache.
 * Offline only — never networks. Public demo must not call this path
 * (demo uses fixture-derived briefs in the loader).
 */
export function buildOfficialBriefs(
  options: BuildOfficialBriefsOptions = {},
): BuildOfficialBriefsResult {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Official briefs build is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic fixture-derived briefs only.",
    );
  }

  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_BRIEFS_DATA_ROOT;
  const docsRoot = options.documentsDataRoot ?? dataRoot;
  const resultsRoot = options.resultsDataRoot ?? dataRoot;

  let documents: OfficialDocument[];
  if (options.documents) {
    documents = [...options.documents];
  } else {
    const loaded = loadDocumentsCache({ dataRoot: docsRoot, now });
    if (!loaded.ok) {
      throw new Error(
        `Cannot build briefs: documents cache ${loaded.reason}: ${loaded.error}`,
      );
    }
    documents = loaded.cache.documents;
  }

  if (documents.length === 0) {
    throw new Error(
      "Cannot build briefs: documents archive is empty (no official documents).",
    );
  }

  const prior = loadBriefsCache({ dataRoot, now });
  const priorByDoc = new Map<string, OfficialBrief>();
  if (prior.ok) {
    for (const b of prior.cache.briefs) {
      priorByDoc.set(b.documentId, b);
    }
  }

  let structuredIndex = indexStructuredReleases([]);
  if (options.structuredReleases) {
    structuredIndex = indexStructuredReleases(options.structuredReleases);
  } else {
    const results = loadResultsCache({ dataRoot: resultsRoot, now });
    if (results.ok) {
      structuredIndex = indexStructuredReleases(results.cache.releases);
    }
  }

  const briefs: OfficialBrief[] = [];
  const errors: BriefBuildError[] = [];
  const revisions: BriefRevisionRecord[] = prior.ok
    ? [...prior.cache.revisions]
    : [];
  const warnings: string[] = [];
  const inputDocuments: BriefInputDocumentRef[] = [];

  for (const doc of documents) {
    inputDocuments.push({
      documentId: doc.id,
      contentHash: doc.contentHash,
      documentType: doc.documentType,
      releaseFamily: doc.releaseFamily,
      publishedAt: doc.publishedAt,
    });

    try {
      const previous = priorByDoc.get(doc.id);
      const nextId = briefIdFor(
        doc.id,
        doc.contentHash,
        BRIEF_EXTRACTOR_VERSION,
      );

      // Idempotent: same doc hash + extractor version → reuse prior brief.
      if (
        previous &&
        previous.documentContentHash === doc.contentHash &&
        previous.extractorVersion === BRIEF_EXTRACTOR_VERSION &&
        previous.id === nextId
      ) {
        briefs.push(previous);
        continue;
      }

      let brief = extractBriefFromDocument(doc, generatedAt);
      brief = applyStructuredCrossCheck(brief, structuredIndex);
      briefs.push(brief);

      if (previous && previous.documentContentHash !== doc.contentHash) {
        revisions.push({
          documentId: doc.id,
          observedAt: generatedAt,
          previousContentHash: previous.documentContentHash,
          currentContentHash: doc.contentHash,
          previousBriefId: previous.id,
          currentBriefId: brief.id,
          reason: "document_revision",
        });
      } else if (
        previous &&
        previous.extractorVersion !== BRIEF_EXTRACTOR_VERSION
      ) {
        revisions.push({
          documentId: doc.id,
          observedAt: generatedAt,
          previousContentHash: previous.documentContentHash,
          currentContentHash: doc.contentHash,
          previousBriefId: previous.id,
          currentBriefId: brief.id,
          reason: "extractor_version",
        });
      }

      warnings.push(...brief.warnings);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ documentId: doc.id, error: message });
    }
  }

  const buildStatus =
    errors.length === 0
      ? "ok"
      : briefs.length > 0
        ? "partial"
        : "failed";

  const cache: CatalystBriefsCache = {
    kind: "CatalystBriefsCache",
    schemaVersion: "0.1.0",
    generatedAt,
    extractorVersion: BRIEF_EXTRACTOR_VERSION,
    buildStatus,
    inputDocuments,
    briefs,
    revisions: revisions.slice(-200),
    warnings,
    errors,
  };

  // Do not overwrite a prior good cache when every document failed.
  const shouldWrite =
    options.write !== false && buildStatus !== "failed";
  let path: string | null = null;
  if (shouldWrite) {
    path = briefsLatestPath(dataRoot);
    writeJsonAtomic(path, cache);
  }

  return { cache, path };
}
