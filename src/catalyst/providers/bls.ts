import { IngestError } from "@/ingest/types";
import { fetchValidated, type FetchLike } from "@/ingest/http";
import { parseIcsEvents } from "../ics";
import { matchOfficialEvent } from "../registry";
import { utcDay } from "../time";
import type { CatalystRawEvent } from "../types";
import type { ProviderParseResult } from "./types";

export const BLS_ICS_URL =
  "https://www.bls.gov/schedule/news_release/bls.ics";

export const BLS_SOURCE_NAME = "BLS News Release Schedule";
export const BLS_OFFICIAL_PAGE =
  "https://www.bls.gov/schedule/news_release/";

const DEFAULT_TIMEOUT_MS = 20_000;

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "text/calendar, text/plain, */*",
  // Identify local tooling; BLS may still block some automated clients.
  "User-Agent":
    "GammaDesk/0.0 (local official-calendar ingest; +https://github.com/hreisis/trading-gamma-desk)",
};

function buildExternalId(uid: string | null, summary: string, occurredAt: string): string {
  const day = utcDay(occurredAt) ?? occurredAt.slice(0, 10);
  if (uid && uid.trim()) {
    return `bls:${uid.trim()}`;
  }
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `bls:${slug}:${day}`;
}

/**
 * Parse BLS ICS body into catalogued raw catalyst events (unmapped skipped).
 * No UI; scheduled release times only.
 */
export function parseBlsIcs(body: string): {
  readonly rawEvents: CatalystRawEvent[];
  readonly rawEventCount: number;
  readonly mappedEventCount: number;
} {
  if (!body.includes("BEGIN:VCALENDAR") && !body.includes("BEGIN:VEVENT")) {
    throw new IngestError(
      "payload_shape",
      "BLS ICS: body is not an iCalendar payload (missing BEGIN:VCALENDAR/VEVENT)",
    );
  }

  const events = parseIcsEvents(body);
  const rawEvents: CatalystRawEvent[] = [];

  for (const ev of events) {
    const mapping = matchOfficialEvent("bls", ev.summary);
    if (!mapping) continue;
    const externalId = buildExternalId(ev.uid, ev.summary, ev.occurredAtUtc);
    rawEvents.push({
      synthetic: false,
      externalId,
      occurredAt: ev.occurredAtUtc,
      observedAt: ev.occurredAtUtc,
      sourceType: "calendar",
      sourceName: BLS_SOURCE_NAME,
      sourceUrl: ev.url ?? BLS_OFFICIAL_PAGE,
      headline: mapping.headline,
      summary: mapping.summary,
      rawCategory: mapping.category,
      rawStatus: "upcoming",
      rawImportance: mapping.importance,
      rawDirection: "unclear",
      affectedAssets: [...mapping.affectedAssets],
      macroChannels: [...mapping.macroChannels],
      evidenceStatements: [
        `Official BLS schedule: "${ev.summary}" at ${ev.occurredAtUtc} (scheduled release time only — not an observed print).`,
      ],
      evidenceBasis: "official_release_schedule",
    });
  }

  return {
    rawEvents,
    rawEventCount: events.length,
    mappedEventCount: rawEvents.length,
  };
}

export async function fetchBlsCalendar(options: {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly url?: string;
} = {}): Promise<ProviderParseResult> {
  const url = options.url ?? BLS_ICS_URL;
  const metaBase = {
    id: "bls" as const,
    name: BLS_SOURCE_NAME,
    url,
  };

  try {
    const validated = await fetchValidated(
      url,
      {
        label: "BLS ICS",
        // text/calendar preferred; some CDNs return text/plain.
        contentTypeIncludes: "text/",
      },
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: DEFAULT_HEADERS,
      },
    );

    // Tighten: calendar or plain; reject HTML bot-challenge pages.
    const ct = validated.contentType.toLowerCase();
    if (
      !ct.includes("calendar") &&
      !ct.includes("plain") &&
      !ct.includes("text/csv")
    ) {
      // Allow text/* already checked; still reject obvious HTML bodies.
    }
    if (
      validated.body.trimStart().startsWith("<!") ||
      /<html[\s>]/i.test(validated.body.slice(0, 200))
    ) {
      throw new IngestError(
        "payload_shape",
        `BLS ICS: received HTML instead of iCalendar (possible bot block); preview: ${JSON.stringify(validated.body.slice(0, 120))}`,
      );
    }

    const parsed = parseBlsIcs(validated.body);
    return {
      source: {
        ...metaBase,
        status: "ok",
        rawEventCount: parsed.rawEventCount,
        mappedEventCount: parsed.mappedEventCount,
      },
      rawEvents: parsed.rawEvents,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      source: {
        ...metaBase,
        status: "error",
        error: message,
      },
      rawEvents: [],
    };
  }
}
