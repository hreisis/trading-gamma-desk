import { existsSync, readFileSync } from "node:fs";
import { Catalyst } from "@/contracts";
import { calendarLatestPath, DEFAULT_CATALYST_DATA_ROOT } from "./fetch-calendar";
import { instantMs } from "./time";
import type { CatalystCalendarCache, CatalystFeedSourceStatus } from "./types";

/** Local cache older than this is served as `stale_calendar`. */
export const CALENDAR_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type CalendarCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystCalendarCache;
      readonly stale: boolean;
      readonly ageMs: number;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly reason: "missing" | "malformed";
      readonly error: string;
      readonly path: string;
    };

function isSourceStatus(value: unknown): value is CatalystFeedSourceStatus {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (v.status === "ok" || v.status === "error" || v.status === "skipped")
  );
}

export function parseCalendarCache(raw: unknown): CatalystCalendarCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("calendar cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystCalendarCache") {
    throw new Error("calendar cache: kind must be CatalystCalendarCache");
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(`calendar cache: unsupported schemaVersion ${String(o.schemaVersion)}`);
  }
  if (typeof o.fetchedAt !== "string" || instantMs(o.fetchedAt) === null) {
    throw new Error("calendar cache: fetchedAt missing or invalid");
  }
  const rw = o.requestedWindow;
  if (!rw || typeof rw !== "object") {
    throw new Error("calendar cache: requestedWindow required");
  }
  const window = rw as Record<string, unknown>;
  if (
    typeof window.now !== "string" ||
    typeof window.start !== "string" ||
    typeof window.end !== "string"
  ) {
    throw new Error("calendar cache: requestedWindow fields invalid");
  }
  if (!Array.isArray(o.sources) || !o.sources.every(isSourceStatus)) {
    throw new Error("calendar cache: sources invalid");
  }
  if (!Array.isArray(o.catalysts)) {
    throw new Error("calendar cache: catalysts must be an array");
  }
  const catalysts = o.catalysts.map((c, i) => {
    const parsed = Catalyst.safeParse(c);
    if (!parsed.success) {
      throw new Error(
        `calendar cache: catalysts[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });
  const validationErrors = Array.isArray(o.validationErrors)
    ? (o.validationErrors as CatalystCalendarCache["validationErrors"])
    : [];
  return {
    kind: "CatalystCalendarCache",
    schemaVersion: "0.1.0",
    fetchedAt: o.fetchedAt,
    requestedWindow: {
      now: window.now,
      start: window.start,
      end: window.end,
    },
    sources: o.sources,
    catalysts,
    validationErrors,
    partialFailure: Boolean(o.partialFailure),
  };
}

/**
 * Read gitignored local calendar cache. Does not fetch network.
 * `now` is injectable for staleness tests.
 */
export function loadCalendarCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): CalendarCacheLoad {
  const path = calendarLatestPath(options.dataRoot ?? DEFAULT_CATALYST_DATA_ROOT);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Official calendar cache missing at ${path}. Run: npm run catalyst:fetch`,
      path,
    };
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseCalendarCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const fetchedMs = instantMs(cache.fetchedAt);
    if (fetchedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "calendar cache: fetchedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - fetchedMs);
    const staleAfter = options.staleAfterMs ?? CALENDAR_STALE_AFTER_MS;
    return {
      ok: true,
      cache,
      stale: ageMs > staleAfter,
      ageMs,
      path,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "malformed",
      error: message,
      path,
    };
  }
}
