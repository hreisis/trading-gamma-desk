import { IngestError } from "@/ingest/types";
import { fetchValidated, type FetchLike } from "@/ingest/http";
import { matchOfficialEvent } from "../registry";
import { toUtcIsoZ, utcDay } from "../time";
import type { CatalystRawEvent } from "../types";
import type { ProviderParseResult } from "./types";

export const BEA_RELEASE_DATES_URL =
  "https://apps.bea.gov/API/signup/release_dates.json";

export const BEA_SOURCE_NAME = "BEA Release Dates";
export const BEA_OFFICIAL_PAGE = "https://www.bea.gov/news/schedule";

const DEFAULT_TIMEOUT_MS = 20_000;

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "application/json, text/json, */*",
  "User-Agent":
    "GammaDesk/0.0 (local official-calendar ingest; +https://github.com/hreisis/trading-gamma-desk)",
};

interface BeaSeriesPayload {
  readonly release_dates?: unknown;
}

function isBeaRoot(value: unknown): value is Record<string, BeaSeriesPayload> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return true;
}

/**
 * Validate and parse BEA release_dates.json into catalogued raw events.
 */
export function parseBeaReleaseDates(body: string): {
  readonly rawEvents: CatalystRawEvent[];
  readonly rawEventCount: number;
  readonly mappedEventCount: number;
} {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new IngestError(
      "payload_shape",
      "BEA JSON: body is not valid JSON",
    );
  }

  if (!isBeaRoot(json)) {
    throw new IngestError(
      "payload_shape",
      "BEA JSON: root must be an object keyed by series title",
    );
  }

  let rawEventCount = 0;
  const rawEvents: CatalystRawEvent[] = [];

  for (const [title, series] of Object.entries(json)) {
    // Metadata keys (e.g. file_last_updated: string) are not series objects.
    if (title === "file_last_updated") continue;
    if (typeof series !== "object" || series === null || Array.isArray(series)) {
      continue;
    }
    const dates = (series as BeaSeriesPayload).release_dates;
    if (dates === undefined) {
      // Unknown object shape without release_dates — skip, do not fail the file.
      continue;
    }
    if (!Array.isArray(dates)) {
      throw new IngestError(
        "payload_shape",
        `BEA JSON: series ${JSON.stringify(title)} release_dates must be an array`,
      );
    }

    const mapping = matchOfficialEvent("bea", title);
    for (const rawDate of dates) {
      rawEventCount += 1;
      if (!mapping) continue;
      if (typeof rawDate !== "string") {
        throw new IngestError(
          "payload_shape",
          `BEA JSON: non-string release date under ${JSON.stringify(title)}`,
        );
      }
      const occurredAt = toUtcIsoZ(rawDate);
      if (!occurredAt) {
        throw new IngestError(
          "payload_shape",
          `BEA JSON: unparseable release date ${JSON.stringify(rawDate)} under ${JSON.stringify(title)}`,
        );
      }
      const day = utcDay(occurredAt) ?? occurredAt.slice(0, 10);
      const seriesSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      rawEvents.push({
        synthetic: false,
        externalId: `bea:${seriesSlug}:${day}:${occurredAt}`,
        occurredAt,
        observedAt: occurredAt,
        sourceType: "calendar",
        sourceName: BEA_SOURCE_NAME,
        sourceUrl: BEA_OFFICIAL_PAGE,
        headline: mapping.headline,
        summary: mapping.summary,
        rawCategory: mapping.category,
        rawStatus: "upcoming",
        rawImportance: mapping.importance,
        rawDirection: "unclear",
        affectedAssets: [...mapping.affectedAssets],
        macroChannels: [...mapping.macroChannels],
        evidenceStatements: [
          `Official BEA schedule: "${title}" at ${occurredAt} (scheduled release time only — not an observed print).`,
        ],
        evidenceBasis: "official_release_schedule",
      });
    }
  }

  return {
    rawEvents,
    rawEventCount,
    mappedEventCount: rawEvents.length,
  };
}

export async function fetchBeaCalendar(options: {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly url?: string;
} = {}): Promise<ProviderParseResult> {
  const url = options.url ?? BEA_RELEASE_DATES_URL;
  const metaBase = {
    id: "bea" as const,
    name: BEA_SOURCE_NAME,
    url,
  };

  try {
    const validated = await fetchValidated(
      url,
      {
        label: "BEA release dates",
        contentTypeIncludes: "json",
      },
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: DEFAULT_HEADERS,
      },
    );

    const parsed = parseBeaReleaseDates(validated.body);
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
