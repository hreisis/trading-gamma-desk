/**
 * Vendor timestamps must be taken by string slice. Converting through a local
 * Date silently shifts the session by one day in ET/PT (verified M1-1).
 */

const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** `"2026-07-29T00:00:00.000Z"` or `"2026-07-29T00:00:00+00:00"` → `2026-07-29`. */
export function sessionDateFromIsoPrefix(raw: string): string {
  const match = ISO_PREFIX.exec(raw.trim());
  if (!match) {
    throw new Error(`expected ISO-prefixed date, got ${JSON.stringify(raw)}`);
  }
  return match[1]!;
}

/** `"07/29/2026"` → `2026-07-29`. */
export function sessionDateFromUs(raw: string): string {
  const match = US_DATE.exec(raw.trim());
  if (!match) {
    throw new Error(`expected MM/DD/YYYY date, got ${JSON.stringify(raw)}`);
  }
  const month = match[1]!.padStart(2, "0");
  const day = match[2]!.padStart(2, "0");
  const year = match[3]!;
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inclusive calendar lookback for the ingest request window. */
export function lookbackStart(endDate: string, calendarDays: number): string {
  return addCalendarDays(endDate, -(calendarDays - 1));
}

/**
 * Drop an in-progress UTC-dated bar. If `todayUtc` is `2026-07-30` and the
 * newest BTC bar is also `2026-07-30`, that bar is still forming and must not
 * be scored.
 */
export function dropInProgressUtcDay(
  sessionDates: readonly string[],
  todayUtc: string,
): string[] {
  return sessionDates.filter((d) => d < todayUtc);
}
