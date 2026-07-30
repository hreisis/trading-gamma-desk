import type {
  Catalyst,
  OfficialDocument,
  OfficialDocumentRef,
} from "@/contracts";
import { DOCUMENT_FAMILY_TO_SCHEDULE_HINTS } from "./registry";
import { easternCalendarDay } from "./period";
import type { DocumentLinkingWarning } from "./types";

export interface DocumentLinkResult {
  readonly catalysts: Catalyst[];
  readonly linkingWarnings: DocumentLinkingWarning[];
  readonly linkedCount: number;
  readonly unmatchedCount: number;
}

function toRef(doc: OfficialDocument): OfficialDocumentRef {
  return {
    id: doc.id,
    provider: doc.provider,
    documentType: doc.documentType,
    releaseFamily: doc.releaseFamily,
    canonicalUrl: doc.canonicalUrl,
    title: doc.title,
    publishedAt: doc.publishedAt,
    contentHash: doc.contentHash,
    ...(doc.referencePeriod ? { referencePeriod: doc.referencePeriod } : {}),
    ...(doc.summaryFromSource
      ? { summaryFromSource: doc.summaryFromSource }
      : {}),
  };
}

function headlineMatches(
  headline: string,
  hints: readonly string[],
): boolean {
  const h = headline.toLowerCase();
  return hints.some((hint) => h.includes(hint));
}

function sameEasternDay(a: string, b: string): boolean {
  const da = easternCalendarDay(a);
  const db = easternCalendarDay(b);
  return Boolean(da && db && da === db);
}

function candidatesForDocument(
  catalysts: readonly Catalyst[],
  doc: OfficialDocument,
): Catalyst[] {
  const hints = DOCUMENT_FAMILY_TO_SCHEDULE_HINTS[doc.releaseFamily];
  const out: Catalyst[] = [];
  for (const c of catalysts) {
    if (hints.releaseFamilyExact) {
      if (c.releaseFamily !== hints.releaseFamilyExact) continue;
      if (doc.referencePeriod && c.referencePeriod) {
        if (c.referencePeriod === doc.referencePeriod) out.push(c);
        continue;
      }
      if (sameEasternDay(doc.publishedAt, c.occurredAt)) out.push(c);
      continue;
    }

    if (!headlineMatches(c.headline, hints.titleIncludes)) continue;
    if (sameEasternDay(doc.publishedAt, c.occurredAt)) out.push(c);
  }
  return out;
}

function attachDocument(catalyst: Catalyst, doc: OfficialDocument): Catalyst {
  const refs = [...(catalyst.officialDocuments ?? [])];
  const idx = refs.findIndex((r) => r.canonicalUrl === doc.canonicalUrl);
  const nextRef = toRef(doc);
  if (idx >= 0) refs[idx] = nextRef;
  else refs.push(nextRef);

  const baseEvidence = catalyst.evidence.filter(
    (e) => e.basis !== "official_release_document",
  );
  const docEvidence = refs.map((r) => ({
    id: `${r.id}_ev`,
    statement: `Official release document: ${r.title} (${r.canonicalUrl})`,
    basis: "official_release_document",
  }));

  return {
    ...catalyst,
    officialDocuments: refs,
    evidence: [...baseEvidence, ...docEvidence],
  };
}

/**
 * Strictly link official documents onto existing catalysts.
 * Never creates a second catalyst from a document.
 */
export function linkDocumentsToCatalysts(
  catalysts: readonly Catalyst[],
  documents: readonly OfficialDocument[],
): DocumentLinkResult {
  const byId = new Map(catalysts.map((c) => [c.id, { ...c }]));
  const warnings: DocumentLinkingWarning[] = [];
  let linkedCount = 0;
  let unmatchedCount = 0;

  for (const doc of documents) {
    if (doc.releaseFamily !== "fomc_policy" && !doc.referencePeriod) {
      warnings.push({
        error: `Document ${doc.id} lacks official referencePeriod`,
        documentId: doc.id,
        releaseFamily: doc.releaseFamily,
        reason: "missing_reference_period",
      });
    }

    const matches = candidatesForDocument([...byId.values()], doc);

    const periodMatches = matches.filter(
      (c) =>
        Boolean(doc.referencePeriod) &&
        c.referencePeriod === doc.referencePeriod,
    );

    let chosen: Catalyst | null = null;
    if (periodMatches.length === 1) {
      chosen = periodMatches[0]!;
    } else if (periodMatches.length > 1) {
      warnings.push({
        error: `Ambiguous document link for ${doc.canonicalUrl}`,
        documentId: doc.id,
        releaseFamily: doc.releaseFamily,
        referencePeriod: doc.referencePeriod,
        reason: "ambiguous_match",
      });
      unmatchedCount += 1;
      continue;
    } else if (matches.length === 1) {
      chosen = matches[0]!;
    } else if (matches.length > 1) {
      warnings.push({
        error: `Ambiguous document link for ${doc.canonicalUrl}`,
        documentId: doc.id,
        releaseFamily: doc.releaseFamily,
        referencePeriod: doc.referencePeriod,
        reason: "ambiguous_match",
      });
      unmatchedCount += 1;
      continue;
    }

    if (!chosen) {
      warnings.push({
        error: `No matching catalyst for document ${doc.title}`,
        documentId: doc.id,
        releaseFamily: doc.releaseFamily,
        referencePeriod: doc.referencePeriod,
        reason: "no_matching_catalyst",
      });
      unmatchedCount += 1;
      continue;
    }

    byId.set(chosen.id, attachDocument(chosen, doc));
    linkedCount += 1;
  }

  return {
    catalysts: catalysts.map((c) => byId.get(c.id) ?? c),
    linkingWarnings: warnings,
    linkedCount,
    unmatchedCount,
  };
}

/** Default feed window: documents published in the last `days` days. */
export function filterDocumentsForFeed(
  documents: readonly OfficialDocument[],
  now: Date,
  days = 30,
): OfficialDocument[] {
  const endMs = now.getTime();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  return documents
    .filter((d) => {
      const ms = Date.parse(d.publishedAt);
      return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
    })
    .sort((a, b) =>
      a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0,
    );
}
