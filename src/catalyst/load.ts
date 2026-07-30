import syntheticBatch from "../../fixtures/catalyst/synthetic-events.json";
import { isPublicDemoMode } from "@/desk/public-demo";
import { loadCalendarCache } from "./cache";
import { normalizeAndDedupe } from "./dedupe";
import { filterCatalysts } from "./query";
import type {
  CatalystFeedResponse,
  CatalystQuery,
  CatalystRawEvent,
} from "./types";

export const CATALYST_DEMO_BANNER =
  "Illustrative catalyst demo · synthetic events";

export const CATALYST_DEMO_DISCLAIMER =
  "Synthetic catalyst fixtures for product demonstration — not actual news, calendar prints, or market observations.";

export const CATALYST_OFFICIAL_BANNER =
  "Official US macro calendar · scheduled release times only";

export const CATALYST_OFFICIAL_DISCLAIMER =
  "BLS and BEA schedule sources list planned release times. A row does not mean the print has been released or observed by GammaDesk — no actual/forecast/surprise is ingested here.";

export const CATALYST_STALE_BANNER =
  "Official US macro calendar · stale local cache";

export const CATALYST_UNAVAILABLE_BANNER =
  "Official US macro calendar · live cache unavailable";

export const SYNTHETIC_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-events.json";

export const OFFICIAL_CALENDAR_CACHE_NAME =
  "data/catalyst/calendar-latest.json";

function rawEventsFromBatch(): CatalystRawEvent[] {
  const events = (syntheticBatch as { events?: CatalystRawEvent[] }).events;
  if (!Array.isArray(events)) return [];
  return events;
}

function loadSyntheticFeed(
  query: CatalystQuery,
  options: { readonly publicDemo: boolean; readonly now: Date },
): CatalystFeedResponse {
  const { catalysts, validationErrors } = normalizeAndDedupe(
    rawEventsFromBatch(),
  );
  const filtered = filterCatalysts(catalysts, query);
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
    },
    count: filtered.length,
    catalysts: filtered,
    validationErrors,
  };
}

/**
 * Catalyst feed loader.
 *
 * - Public demo: always synthetic fixtures; never reads calendar cache; never network.
 * - Local: official calendar cache when present; missing/malformed → explicit
 *   `live_unavailable` (no silent synthetic fallback). Stale cache → `stale_calendar`
 *   with data + warning. Partial provider failure is surfaced via source statuses.
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

  if (!loaded.ok) {
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
      },
      count: 0,
      catalysts: [],
      validationErrors: [
        {
          index: -1,
          error: loaded.error,
        },
      ],
    };
  }

  const { cache, stale } = loaded;
  const filtered = filterCatalysts(cache.catalysts, query);
  const partialFailure = cache.partialFailure;

  let banner = CATALYST_OFFICIAL_BANNER;
  if (stale) banner = CATALYST_STALE_BANNER;
  if (partialFailure) {
    banner = stale
      ? `${CATALYST_STALE_BANNER} · partial source failure`
      : `${CATALYST_OFFICIAL_BANNER} · partial source failure`;
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
    },
    count: filtered.length,
    catalysts: filtered,
    validationErrors: cache.validationErrors,
  };
}
