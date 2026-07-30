/**
 * Convert a wall-clock local time in a named IANA zone to a UTC Date.
 * Handles DST by iterating Intl offsets (no external tz database dependency).
 */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const asLocalMs = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = desiredMs - asLocalMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

/** US official release / FOMC schedule wall-clock zone. */
export const AMERICA_NEW_YORK = "America/New_York";

/** @deprecated Prefer AMERICA_NEW_YORK — BLS floating ICS times use Eastern. */
export const BLS_SCHEDULE_TIMEZONE = AMERICA_NEW_YORK;
