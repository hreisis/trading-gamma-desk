import { defaultSessionCalendar, type SessionCalendar } from "@/macro/calendar";
import { SPY_BREADTH_CONFIG } from "../config";

const MS_PER_DAY = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function nextTradingSession(
  date: string,
  calendar: SessionCalendar = defaultSessionCalendar,
): string | null {
  let ms = toUtc(date);
  for (let i = 0; i < 14; i += 1) {
    ms += MS_PER_DAY;
    const candidate = toIso(ms);
    if (calendar.isSession(candidate)) return candidate;
  }
  return null;
}

/** Trading sessions strictly after `from` through `to`, inclusive of `to`. */
export function tradingSessionLag(
  from: string,
  to: string,
  calendar: SessionCalendar = defaultSessionCalendar,
): number | null {
  if (!calendar.isSession(from) || !calendar.isSession(to)) return null;
  if (from > to) return null;
  let lag = 0;
  let cursor = from;
  while (cursor < to) {
    const next = nextTradingSession(cursor, calendar);
    if (!next) return null;
    lag += 1;
    cursor = next;
  }
  return lag;
}

export function evaluateUniverseFreshness(input: {
  readonly universeAsOf: string;
  readonly targetMarketSessionDate: string;
  readonly calendar?: SessionCalendar;
}): {
  readonly sessionLag: number | null;
  readonly stale: boolean;
  readonly status: "available" | "unavailable";
  readonly missingReason: string | null;
} {
  const calendar = input.calendar ?? defaultSessionCalendar;
  if (!calendar.isSession(input.targetMarketSessionDate)) {
    return {
      sessionLag: null,
      stale: true,
      status: "unavailable",
      missingReason: `Target ${input.targetMarketSessionDate} is not a US trading session.`,
    };
  }
  const lag = tradingSessionLag(
    input.universeAsOf,
    input.targetMarketSessionDate,
    calendar,
  );
  if (lag === null) {
    return {
      sessionLag: null,
      stale: true,
      status: "unavailable",
      missingReason: "Unable to compute trading-session lag for SPY holdings.",
    };
  }
  const stale = lag > SPY_BREADTH_CONFIG.maxUniverseSessionLag;
  return {
    sessionLag: lag,
    stale,
    status: stale ? "unavailable" : "available",
    missingReason: stale
      ? `SPY holdings asOf ${input.universeAsOf} lags target by ${lag} trading sessions (max ${SPY_BREADTH_CONFIG.maxUniverseSessionLag}).`
      : null,
  };
}
