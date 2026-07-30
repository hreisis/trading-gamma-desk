import type { Catalyst } from "@/contracts";
import { normalizeCatalystEvent, preferCatalyst } from "./normalize";
import type { CatalystRawEvent, NormalizeErr } from "./types";

export interface DedupeResult {
  readonly catalysts: Catalyst[];
  readonly validationErrors: Array<{
    readonly index: number;
    readonly error: string;
    readonly externalId?: string;
  }>;
  readonly droppedDuplicates: number;
}

/**
 * Normalize a batch, fold duplicates by dedupeKey (and supersedesExternalId),
 * keep the preferred update. Order: newest observedAt first, then importance.
 */
export function normalizeAndDedupe(
  rawEvents: readonly CatalystRawEvent[],
): DedupeResult {
  const byKey = new Map<string, Catalyst>();
  const validationErrors: DedupeResult["validationErrors"] = [];
  let droppedDuplicates = 0;

  rawEvents.forEach((raw, index) => {
    const result = normalizeCatalystEvent(raw);
    if (!result.ok) {
      const err = result as NormalizeErr;
      validationErrors.push({
        index,
        error: err.error,
        externalId: raw.externalId,
      });
      return;
    }
    const { catalyst } = result;
    // Allow supersession via shared external identity key.
    const altKey =
      raw.supersedesExternalId &&
      `ext:${raw.supersedesExternalId.trim().toLowerCase()}`;
    const existing =
      byKey.get(catalyst.dedupeKey) ??
      (altKey ? byKey.get(altKey) : undefined);
    if (existing) {
      droppedDuplicates += 1;
      const winner = preferCatalyst(existing, catalyst);
      byKey.set(winner.dedupeKey, winner);
      if (altKey) byKey.set(altKey, winner);
      return;
    }
    byKey.set(catalyst.dedupeKey, catalyst);
  });

  // Collapse alt keys that point at the same id.
  const unique = new Map<string, Catalyst>();
  for (const c of byKey.values()) {
    unique.set(c.id, c);
  }

  const catalysts = [...unique.values()].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) {
      return a.occurredAt < b.occurredAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : 1;
  });

  return { catalysts, validationErrors, droppedDuplicates };
}
