import { join } from "node:path";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import { normalizeAndDedupe } from "./dedupe";
import { fetchBeaCalendar } from "./providers/bea";
import { fetchBlsCalendar } from "./providers/bls";
import { fetchFomcCalendar } from "./providers/fomc";
import type { FetchLike, ProviderParseResult } from "./providers/types";
import { buildTimeWindow, isInTimeWindow } from "./window";
import type { CatalystCalendarCache, CatalystFeedSourceStatus } from "./types";

export const DEFAULT_CATALYST_DATA_ROOT = join(process.cwd(), "data");
export const CALENDAR_LATEST_RELATIVE = "catalyst/calendar-latest.json";

export function calendarLatestPath(dataRoot: string = DEFAULT_CATALYST_DATA_ROOT): string {
  return join(dataRoot, CALENDAR_LATEST_RELATIVE);
}

export interface FetchOfficialCalendarOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** When true, skip network and throw — public demo must never call providers. */
  readonly publicDemo?: boolean;
  readonly write?: boolean;
}

export interface FetchOfficialCalendarResult {
  readonly cache: CatalystCalendarCache;
  readonly path: string | null;
}

function toSourceStatus(result: ProviderParseResult): CatalystFeedSourceStatus {
  return {
    id: result.source.id,
    name: result.source.name,
    url: result.source.url,
    status: result.source.status,
    error: result.source.error,
    mappedEventCount: result.source.mappedEventCount,
  };
}

/**
 * Fetch BLS + BEA + Federal Reserve schedules, normalize through the shared
 * pipeline, optionally atomically write `data/catalyst/calendar-latest.json`.
 *
 * Never runs under public-demo mode.
 */
export async function fetchOfficialCalendar(
  options: FetchOfficialCalendarOptions = {},
): Promise<FetchOfficialCalendarResult> {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Official calendar fetch is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo serves synthetic fixtures only and must not call BLS/BEA/Federal Reserve.",
    );
  }

  const now = options.now ?? new Date();
  const window = buildTimeWindow(now);
  const providerResults = await Promise.all([
    fetchBlsCalendar({
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    }),
    fetchBeaCalendar({
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    }),
    fetchFomcCalendar({
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      now,
    }),
  ]);

  const combinedRaw = providerResults
    .flatMap((r) => r.rawEvents)
    .filter((raw) => {
      if (!raw.occurredAt) return false;
      return isInTimeWindow(raw.occurredAt, window);
    });

  const { catalysts, validationErrors } = normalizeAndDedupe(combinedRaw);

  const sources = providerResults.map(toSourceStatus);
  const partialFailure = sources.some((s) => s.status === "error");
  const allFailed = sources.every((s) => s.status === "error");

  const cache: CatalystCalendarCache = {
    kind: "CatalystCalendarCache",
    schemaVersion: "0.1.0",
    fetchedAt: now.toISOString(),
    requestedWindow: {
      now: window.now,
      start: window.start,
      end: window.end,
    },
    sources,
    catalysts,
    validationErrors,
    partialFailure,
  };

  // Do not overwrite a prior good cache when every provider fails.
  const shouldWrite = options.write !== false && !allFailed;
  let path: string | null = null;
  if (shouldWrite) {
    path = calendarLatestPath(options.dataRoot ?? DEFAULT_CATALYST_DATA_ROOT);
    writeJsonAtomic(path, cache);
  }

  return { cache, path };
}
