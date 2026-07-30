import type { OfficialDocument } from "@/contracts";
import { OfficialDocument as OfficialDocumentSchema } from "@/contracts";
import { documentContentHash, documentIdFromUrl } from "./hash";
import {
  extractReferencePeriodFromTitle,
  parsePublishedAt,
} from "./period";
import type { DocumentTypeMapping, RawDocumentItem } from "./types";
import { validateCanonicalOfficialUrl } from "./url";

export interface BuildDocumentOptions {
  readonly mapping: DocumentTypeMapping;
  readonly item: RawDocumentItem;
  readonly observedAt: string;
  readonly contentText?: string;
  readonly synthetic?: boolean;
  /** When true, require a parseable reference period (BLS/BEA releases). */
  readonly requireReferencePeriod?: boolean;
}

export type BuildDocumentResult =
  | { readonly ok: true; readonly document: OfficialDocument }
  | { readonly ok: false; readonly error: string; readonly externalId?: string };

export function buildOfficialDocument(
  options: BuildDocumentOptions,
): BuildDocumentResult {
  const { mapping, item, observedAt } = options;
  const urlCheck = validateCanonicalOfficialUrl(item.link, item.provider);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error, externalId: item.link };
  }

  const publishedAt = parsePublishedAt(item.publishedAtRaw);
  if (!publishedAt) {
    return {
      ok: false,
      error: `unparseable publishedAt: ${item.publishedAtRaw}`,
      externalId: urlCheck.url,
    };
  }

  const referencePeriod = extractReferencePeriodFromTitle(item.title);
  if (options.requireReferencePeriod && !referencePeriod) {
    return {
      ok: false,
      error: `reference period not stated in title: ${item.title}`,
      externalId: urlCheck.url,
    };
  }

  // Source summary only when the feed itself provided a description.
  const summaryFromSource = item.summaryFromSource?.trim() || undefined;
  const contentText = options.contentText?.trim() || undefined;
  const contentHash = documentContentHash({
    title: item.title,
    contentText,
    summaryFromSource,
  });

  const draft: OfficialDocument = {
    schemaVersion: "0.1.0",
    id: documentIdFromUrl(urlCheck.url),
    provider: item.provider,
    sourceName: mapping.sourceName,
    canonicalUrl: urlCheck.url,
    title: item.title.trim(),
    publishedAt,
    observedAt,
    documentType: mapping.documentType,
    releaseFamily: mapping.releaseFamily,
    ...(referencePeriod ? { referencePeriod } : {}),
    ...(summaryFromSource ? { summaryFromSource } : {}),
    ...(contentText ? { contentText } : {}),
    contentHash,
    synthetic: options.synthetic ?? false,
  };

  const parsed = OfficialDocumentSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "schema validation failed",
      externalId: urlCheck.url,
    };
  }
  return { ok: true, document: parsed.data };
}

export function mergeDocumentArchives(
  previous: readonly OfficialDocument[] | undefined,
  next: readonly OfficialDocument[],
): OfficialDocument[] {
  const byUrl = new Map<string, OfficialDocument>();
  for (const d of previous ?? []) {
    byUrl.set(d.canonicalUrl, d);
  }
  for (const d of next) {
    const old = byUrl.get(d.canonicalUrl);
    if (!old || old.contentHash !== d.contentHash || d.observedAt >= old.observedAt) {
      byUrl.set(d.canonicalUrl, d);
    }
  }
  return [...byUrl.values()].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0,
  );
}
