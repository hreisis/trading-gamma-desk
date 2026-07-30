import { AMERICA_NEW_YORK, zonedLocalToUtc } from "../timezone";
import { US_MARKET_HOLIDAYS, defaultSessionCalendar } from "@/macro/calendar";

/**
 * Known NYSE early-close calendar dates (1:00 p.m. ET). Extend as needed.
 * Independence Day week / Christmas Eve / day after Thanksgiving are typical.
 */
export const US_EARLY_CLOSE_DATES: ReadonlySet<string> = new Set([
  "2025-07-03",
  "2025-11-28",
  "2025-12-24",
  "2026-11-27",
  "2026-12-24",
]);

export function easternDateParts(utc: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  date: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AMERICA_NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utc);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year,
    month,
    day,
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function easternWallToUtc(
  date: string,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return zonedLocalToUtc(y, m, d, hour, minute, second, AMERICA_NEW_YORK);
}

export interface EventSessionContext {
  readonly easternDate: string;
  readonly timezone: "America/New_York";
  readonly isHoliday: boolean;
  readonly isWeekend: boolean;
  readonly isEarlyClose: boolean;
  readonly regularSessionOpenEt: string | undefined;
  readonly regularSessionCloseEt: string | undefined;
  readonly regularSessionOpenUtc: Date | null;
  readonly regularSessionCloseUtc: Date | null;
  readonly premarketOpenUtc: Date | null;
  readonly eventInPremarket: boolean;
  readonly eventInRegularSession: boolean;
}

/**
 * Classify the event against the US equity session on its Eastern calendar day.
 */
export function classifyEventSession(eventUtc: Date): EventSessionContext {
  const et = easternDateParts(eventUtc);
  const weekday = new Date(
    Date.UTC(et.year, et.month - 1, et.day),
  ).getUTCDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const isHoliday = US_MARKET_HOLIDAYS.has(et.date);
  const isEarlyClose = US_EARLY_CLOSE_DATES.has(et.date);
  const sessionDay =
    !isWeekend && !isHoliday && defaultSessionCalendar.isSession(et.date);

  const openUtc = sessionDay ? easternWallToUtc(et.date, 9, 30, 0) : null;
  const closeHour = isEarlyClose ? 13 : 16;
  const closeUtc = sessionDay
    ? easternWallToUtc(et.date, closeHour, 0, 0)
    : null;
  const premarketOpenUtc = sessionDay
    ? easternWallToUtc(et.date, 4, 0, 0)
    : null;

  const eventMs = eventUtc.getTime();
  const eventInRegularSession =
    openUtc !== null &&
    closeUtc !== null &&
    eventMs >= openUtc.getTime() &&
    eventMs < closeUtc.getTime();
  const eventInPremarket =
    premarketOpenUtc !== null &&
    openUtc !== null &&
    eventMs >= premarketOpenUtc.getTime() &&
    eventMs < openUtc.getTime();

  return {
    easternDate: et.date,
    timezone: AMERICA_NEW_YORK,
    isHoliday,
    isWeekend,
    isEarlyClose: sessionDay ? isEarlyClose : false,
    regularSessionOpenEt: sessionDay ? "09:30" : undefined,
    regularSessionCloseEt: sessionDay
      ? isEarlyClose
        ? "13:00"
        : "16:00"
      : undefined,
    regularSessionOpenUtc: openUtc,
    regularSessionCloseUtc: closeUtc,
    premarketOpenUtc,
    eventInPremarket,
    eventInRegularSession,
  };
}
