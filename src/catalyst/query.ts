import type { Catalyst } from "@/contracts";
import type { CatalystQuery } from "./types";

export function filterCatalysts(
  catalysts: readonly Catalyst[],
  query: CatalystQuery = {},
): Catalyst[] {
  return catalysts.filter((c) => {
    if (query.category && c.category !== query.category) return false;
    if (query.status && c.status !== query.status) return false;
    if (query.importance && c.importance !== query.importance) return false;
    if (query.affectedAsset) {
      const needle = query.affectedAsset.toUpperCase();
      const hit = c.affectedAssets.some(
        (a) => String(a).toUpperCase() === needle,
      );
      if (!hit) return false;
    }
    if (query.start && c.occurredAt < query.start) return false;
    if (query.end && c.occurredAt > query.end) return false;
    return true;
  });
}
