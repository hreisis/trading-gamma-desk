import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { IngestError } from "@/ingest/types";
import { fetchValidated, type FetchLike } from "@/ingest/http";
import { requireOfficialEvent } from "../registry";
import { AMERICA_NEW_YORK, zonedLocalToUtc } from "../timezone";
import type { CatalystRawEvent } from "../types";
import type { ProviderParseResult } from "./types";

export const FOMC_CALENDAR_URL =
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

export const FOMC_SOURCE_NAME = "Federal Reserve FOMC Calendars";

const DEFAULT_TIMEOUT_MS = 20_000;
const FOMC_ZONE = AMERICA_NEW_YORK;

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "GammaDesk/0.0 (local official-calendar ingest; +https://github.com/hreisis/trading-gamma-desk)",
};

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type FomcEventType = "policy-decision" | "press-conference";

export interface ParsedFomcMeeting {
  readonly year: number;
  readonly monthLabel: string;
  readonly dateLabel: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  readonly includesSep: boolean;
  readonly tentative: boolean;
}

function textContent(el: HTMLElement | null): string {
  return (el?.text ?? "").replace(/\s+/g, " ").trim();
}

/** Calendar year in America/New_York for injectable `now`. */
export function easternCalendarYear(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FOMC_ZONE,
    year: "numeric",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "year")?.value);
}

function parseMonthToken(token: string): number | null {
  const key = token.trim().toLowerCase();
  return MONTH_NAME_TO_NUM[key] ?? null;
}

/**
 * Resolve meeting start/end calendar dates from Fed month + date cells.
 * Supports `January` + `27-28`, `Apr/May` + `30-1`, and SEP `*`.
 */
export function resolveFomcMeetingDates(
  year: number,
  monthLabel: string,
  dateLabel: string,
): {
  startDate: string;
  endDate: string;
  includesSep: boolean;
  skip: boolean;
  skipReason?: string;
} {
  const rawDate = dateLabel.trim();
  if (/notation\s+vote/i.test(rawDate)) {
    return {
      startDate: "",
      endDate: "",
      includesSep: false,
      skip: true,
      skipReason: "notation vote",
    };
  }

  const includesSep = /\*/.test(rawDate);
  const dateCore = rawDate.replace(/\*/g, "").trim();
  const range = dateCore.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  const single = dateCore.match(/^(\d{1,2})$/);
  if (!range && !single) {
    return {
      startDate: "",
      endDate: "",
      includesSep: false,
      skip: true,
      skipReason: `unrecognized date label ${JSON.stringify(rawDate)}`,
    };
  }

  const startDay = Number(range?.[1] ?? single?.[1]);
  const endDay = Number(range?.[2] ?? single?.[1]);
  if (![startDay, endDay].every((n) => Number.isFinite(n) && n >= 1 && n <= 31)) {
    return {
      startDate: "",
      endDate: "",
      includesSep: false,
      skip: true,
      skipReason: "invalid day numbers",
    };
  }

  const monthParts = monthLabel.split("/").map((p) => p.trim()).filter(Boolean);
  const startMonth = parseMonthToken(monthParts[0] ?? "");
  if (startMonth === null) {
    return {
      startDate: "",
      endDate: "",
      includesSep: false,
      skip: true,
      skipReason: `unrecognized month ${JSON.stringify(monthLabel)}`,
    };
  }

  let endMonth = startMonth;
  let endYear = year;
  if (monthParts.length >= 2) {
    const m2 = parseMonthToken(monthParts[1] ?? "");
    if (m2 === null) {
      return {
        startDate: "",
        endDate: "",
        includesSep: false,
        skip: true,
        skipReason: `unrecognized cross-month ${JSON.stringify(monthLabel)}`,
      };
    }
    endMonth = m2;
    if (endMonth < startMonth) endYear = year + 1;
  } else if (endDay < startDay) {
    // Same label month, day wraps (rare without Apr/May form).
    endMonth = startMonth === 12 ? 1 : startMonth + 1;
    endYear = startMonth === 12 ? year + 1 : year;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    startDate: `${year}-${pad(startMonth)}-${pad(startDay)}`,
    endDate: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
    includesSep,
    skip: false,
  };
}

function easternWallToUtcIso(
  ymd: string,
  hour: number,
  minute: number,
): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return zonedLocalToUtc(y!, m!, d!, hour, minute, 0, FOMC_ZONE).toISOString();
}

function formatEasternClock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour >= 12 ? "p.m." : "a.m.";
  const mm = String(minute).padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

function buildRawEvent(options: {
  readonly meeting: ParsedFomcMeeting;
  readonly eventType: FomcEventType;
  readonly observedAt: string;
}): CatalystRawEvent {
  const mapping = requireOfficialEvent(
    "federal_reserve",
    options.eventType === "policy-decision"
      ? "FOMC policy decision"
      : "Federal Reserve Chair press conference",
  );

  const hour = 14;
  const minute = options.eventType === "policy-decision" ? 0 : 30;
  const occurredAt = easternWallToUtcIso(options.meeting.endDate, hour, minute);
  const externalId = `fomc:${options.eventType}:${options.meeting.endDate}`;

  const sepNote =
    options.eventType === "policy-decision" && options.meeting.includesSep
      ? " Includes Summary of Economic Projections."
      : "";
  const tentativeNote = options.meeting.tentative
    ? " Schedule for this year may be tentative until confirmed at the preceding meeting."
    : "";
  const easternNote = ` Official scheduled time ${formatEasternClock(hour, minute)} Eastern Time (${FOMC_ZONE}) on meeting end date ${options.meeting.endDate}.`;

  const headline =
    options.eventType === "policy-decision" && options.meeting.includesSep
      ? "FOMC policy decision (scheduled; includes Summary of Economic Projections)"
      : mapping.headline;

  const summary = `${mapping.summary}${sepNote}${tentativeNote}${easternNote} Not an observed decision or market direction.`;

  return {
    synthetic: false,
    externalId,
    occurredAt,
    observedAt: options.observedAt,
    sourceType: "calendar",
    sourceName: FOMC_SOURCE_NAME,
    sourceUrl: FOMC_CALENDAR_URL,
    headline,
    summary,
    rawCategory: mapping.category,
    rawStatus: "upcoming",
    rawImportance: mapping.importance,
    rawDirection: "unclear",
    affectedAssets: [...mapping.affectedAssets],
    macroChannels: [...mapping.macroChannels],
    evidenceStatements: [
      `Official FOMC calendar: ${options.meeting.monthLabel} ${options.meeting.dateLabel} (${options.meeting.year}) → meeting end ${options.meeting.endDate}; ${options.eventType} scheduled at ${formatEasternClock(hour, minute)} ET.${sepNote}${tentativeNote}`,
    ],
    evidenceBasis: "official_fomc_schedule",
  };
}

/**
 * Parse Federal Reserve FOMC calendars HTML into scheduled raw catalyst events.
 * Uses structured selectors on `.panel` / `.fomc-meeting` — not whole-page regex.
 * Ignores statement/minutes/press links (historical artifacts are not upcoming events).
 */
export function parseFomcCalendarHtml(
  body: string,
  options: { readonly now?: Date; readonly observedAt?: string } = {},
): {
  readonly meetings: ParsedFomcMeeting[];
  readonly rawEvents: CatalystRawEvent[];
  readonly rawEventCount: number;
  readonly mappedEventCount: number;
} {
  if (!body.includes("fomc-meeting") && !/FOMC Meetings/i.test(body)) {
    throw new IngestError(
      "payload_shape",
      "FOMC HTML: missing expected FOMC meeting structure (fomc-meeting / FOMC Meetings)",
    );
  }

  const root = parseHtml(body);
  const now = options.now ?? new Date();
  const observedAt = options.observedAt ?? now.toISOString();
  const currentYear = easternCalendarYear(now);
  const targetYears = new Set([currentYear, currentYear + 1]);

  const meetings: ParsedFomcMeeting[] = [];
  const panels = root.querySelectorAll("div.panel.panel-default");

  for (const panel of panels) {
    const heading = textContent(panel.querySelector(".panel-heading h4, h4"));
    const yearMatch = heading.match(/\b(20\d{2})\s+FOMC Meetings\b/i);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    if (!targetYears.has(year)) continue;

    const tentative = year > currentYear;
    const rows = panel.querySelectorAll(".fomc-meeting");
    for (const row of rows) {
      const monthLabel = textContent(row.querySelector(".fomc-meeting__month"));
      const dateLabel = textContent(row.querySelector(".fomc-meeting__date"));
      if (!monthLabel || !dateLabel) continue;

      const resolved = resolveFomcMeetingDates(year, monthLabel, dateLabel);
      if (resolved.skip) continue;

      meetings.push({
        year,
        monthLabel,
        dateLabel,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        includesSep: resolved.includesSep,
        tentative,
      });
    }
  }

  if (meetings.length === 0) {
    throw new IngestError(
      "payload_shape",
      `FOMC HTML: no meetings parsed for years ${[...targetYears].join(", ")} — page structure may have changed`,
    );
  }

  const rawEvents: CatalystRawEvent[] = [];
  for (const meeting of meetings) {
    rawEvents.push(
      buildRawEvent({ meeting, eventType: "policy-decision", observedAt }),
      buildRawEvent({ meeting, eventType: "press-conference", observedAt }),
    );
  }

  return {
    meetings,
    rawEvents,
    rawEventCount: meetings.length,
    mappedEventCount: rawEvents.length,
  };
}

export async function fetchFomcCalendar(options: {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly url?: string;
  readonly now?: Date;
} = {}): Promise<ProviderParseResult> {
  const url = options.url ?? FOMC_CALENDAR_URL;
  const metaBase = {
    id: "federal_reserve" as const,
    name: FOMC_SOURCE_NAME,
    url,
  };

  try {
    const validated = await fetchValidated(
      url,
      {
        label: "Federal Reserve FOMC calendar",
        contentTypeIncludes: "html",
      },
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: DEFAULT_HEADERS,
      },
    );

    const parsed = parseFomcCalendarHtml(validated.body, {
      now: options.now,
      observedAt: (options.now ?? new Date()).toISOString(),
    });

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
    const message = error instanceof Error ? error.message : String(error);
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
