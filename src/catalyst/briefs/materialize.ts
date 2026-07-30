import type { OfficialBrief, OfficialDocument } from "@/contracts";

/** Default UI window: briefs whose source document published in last N days. */
export function filterBriefsForFeed(
  briefs: readonly OfficialBrief[],
  publishedAtByDocumentId: ReadonlyMap<string, string>,
  now: Date,
  days = 30,
): OfficialBrief[] {
  const endMs = now.getTime();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  return briefs
    .filter((b) => {
      const published =
        publishedAtByDocumentId.get(b.documentId) ?? b.generatedAt;
      const ms = Date.parse(published);
      return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
    })
    .sort((a, b) => {
      const da =
        publishedAtByDocumentId.get(a.documentId) ?? a.generatedAt;
      const db =
        publishedAtByDocumentId.get(b.documentId) ?? b.generatedAt;
      return da < db ? 1 : da > db ? -1 : 0;
    });
}

export function publishedAtMapFromDocuments(
  documents: readonly OfficialDocument[],
): Map<string, string> {
  return new Map(documents.map((d) => [d.id, d.publishedAt]));
}

export function indexBriefsByDocumentId(
  briefs: readonly OfficialBrief[],
): Map<string, OfficialBrief> {
  const map = new Map<string, OfficialBrief>();
  for (const b of briefs) {
    map.set(b.documentId, b);
  }
  return map;
}
