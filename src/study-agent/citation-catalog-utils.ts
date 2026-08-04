import type { StudyMemoCitationCatalog, StudyMemoCitationEntry } from "./citation-catalog";

export function buildCitationCatalogFromPacketEntries(
  entries: readonly StudyMemoCitationEntry[],
): StudyMemoCitationCatalog {
  const idToPath = new Map<string, string>();
  for (const entry of entries) {
    idToPath.set(entry.id, entry.path);
  }
  return { entries, idToPath };
}
