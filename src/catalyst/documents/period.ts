const MONTHS: Record<string, number> = {
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Extract official reference period from a release title when explicitly stated.
 * Returns YYYY-MM or YYYY-Qn — never guesses from the publication calendar day.
 */
export function extractReferencePeriodFromTitle(title: string): string | undefined {
  const t = title.replace(/\s+/g, " ").trim();

  const quarter = t.match(
    /\b(\d)(?:st|nd|rd|th)\s+Quarter\s+(?:and\s+Year\s+)?(\d{4})\b/i,
  );
  if (quarter) {
    const q = Number(quarter[1]);
    const y = Number(quarter[2]);
    if (q >= 1 && q <= 4 && y >= 1990 && y <= 2100) {
      return `${y}-Q${q}`;
    }
  }

  const monthYear = t.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i,
  );
  if (monthYear) {
    const month = MONTHS[monthYear[1]!.toLowerCase()];
    const y = Number(monthYear[2]);
    if (month && y >= 1990 && y <= 2100) {
      return `${y}-${pad2(month)}`;
    }
  }

  // BLS style: "THE EMPLOYMENT SITUATION -- JUNE 2026"
  const blsDash = t.match(
    /--\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (blsDash) {
    const month = MONTHS[blsDash[1]!.toLowerCase()];
    const y = Number(blsDash[2]);
    if (month && y >= 1990 && y <= 2100) {
      return `${y}-${pad2(month)}`;
    }
  }

  return undefined;
}

/** Parse RFC-822 / ISO publish timestamps to UTC ISO. */
export function parsePublishedAt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Calendar day in America/New_York for schedule-day linking. */
export function easternCalendarDay(isoUtc: string): string | null {
  const ms = Date.parse(isoUtc);
  if (!Number.isFinite(ms)) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → YYYY-MM-DD
  return fmt.format(new Date(ms));
}
