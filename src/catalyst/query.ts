import type { Catalyst } from "@/contracts";
import { instantMs } from "./time";
import type { CatalystQuery } from "./types";

export function filterCatalysts(
  catalysts: readonly Catalyst[],
  query: CatalystQuery = {},
): Catalyst[] {
  const startMs = query.start ? instantMs(query.start) : null;
  const endMs = query.end ? instantMs(query.end) : null;

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
    const occurredMs = instantMs(c.occurredAt);
    if (occurredMs === null) return false;
    // Inclusive bounds on true instants (mixed offsets OK).
    if (startMs !== null && occurredMs < startMs) return false;
    if (endMs !== null && occurredMs > endMs) return false;
    return true;
  });
}
