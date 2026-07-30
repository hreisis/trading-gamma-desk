import syntheticBatch from "../../fixtures/catalyst/synthetic-events.json";
import { isPublicDemoMode } from "@/desk/public-demo";
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

export const SYNTHETIC_FIXTURE_NAME =
  "fixtures/catalyst/synthetic-events.json";

function rawEventsFromBatch(): CatalystRawEvent[] {
  const events = (syntheticBatch as { events?: CatalystRawEvent[] }).events;
  if (!Array.isArray(events)) return [];
  return events;
}

/**
 * Fixture-only ingestion for M2-1. Bundled via static import so public hosts
 * do not need fixtures/ on disk. No network, no LLM.
 */
export function loadCatalystFeed(
  query: CatalystQuery = {},
  options: { readonly publicDemo?: boolean; readonly now?: Date } = {},
): CatalystFeedResponse {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  const { catalysts, validationErrors } = normalizeAndDedupe(
    rawEventsFromBatch(),
  );
  const filtered = filterCatalysts(catalysts, query);
  const generatedAt = (options.now ?? new Date()).toISOString();

  return {
    kind: "CatalystFeed",
    schemaVersion: "0.1.0",
    generatedAt,
    mode: "synthetic_demo",
    isPublicDemo: publicDemo,
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
