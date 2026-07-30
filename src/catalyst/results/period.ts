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

/** Canonical reference period YYYY-MM. */
export function formatReferencePeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** BLS API period token e.g. 2026-M06 (excludes annual M13). */
export function formatSourcePeriod(year: number, month: number): string {
  return `${year}-M${String(month).padStart(2, "0")}`;
}

export function parseBlsYearPeriod(
  year: string,
  period: string,
): { year: number; month: number; referencePeriod: string; sourcePeriod: string } | null {
  if (period === "M13" || period === "A01") return null; // annual averages
  const m = period.match(/^M(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const y = Number(year);
  if (!Number.isFinite(y) || month < 1 || month > 12) return null;
  return {
    year: y,
    month,
    referencePeriod: formatReferencePeriod(y, month),
    sourcePeriod: formatSourcePeriod(y, month),
  };
}

/**
 * Extract reference period from official BLS schedule DESCRIPTION / SUMMARY text.
 * Returns null when metadata does not contain an explicit month+year
 * (never invent via “release date minus one month”).
 */
export function parseReferencePeriodFromScheduleText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /\b(?:for\s+)?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/i,
  );
  if (!match) return null;
  const month = MONTH_NAME_TO_NUM[match[1]!.toLowerCase()];
  const year = Number(match[2]);
  if (month === undefined || !Number.isFinite(year)) return null;
  return formatReferencePeriod(year, month);
}

export function compareReferencePeriod(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
