import type { StudyPriceBar } from "@/contracts";

export class StudySessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudySessionError";
  }
}

export interface SessionCalendar {
  readonly sessionDates: readonly string[];
  /** adjClose keyed by sessionDate — sparse calendar (weekends/holidays omitted). */
  readonly adjCloseByDate: ReadonlyMap<string, number>;
}

/**
 * Build a strictly-increasing trading-session calendar from price bars.
 * Only dates present in the series are sessions — weekends and market holidays
 * are absent by construction (no calendar-day interpolation).
 */
export function buildSessionCalendar(
  bars: readonly StudyPriceBar[],
): SessionCalendar {
  const adjCloseByDate = new Map<string, number>();
  const sessionDates: string[] = [];

  for (const bar of bars) {
    if (adjCloseByDate.has(bar.sessionDate)) {
      throw new StudySessionError(
        `duplicate sessionDate in price series: ${bar.sessionDate}`,
      );
    }
    if (
      sessionDates.length > 0 &&
      bar.sessionDate <= sessionDates[sessionDates.length - 1]!
    ) {
      throw new StudySessionError(
        `bars must be strictly increasing; got ${bar.sessionDate} after ${sessionDates[sessionDates.length - 1]}`,
      );
    }
    if (!Number.isFinite(bar.adjClose) || bar.adjClose <= 0) {
      throw new StudySessionError(
        `invalid adjClose for ${bar.sessionDate}: ${bar.adjClose}`,
      );
    }
    adjCloseByDate.set(bar.sessionDate, bar.adjClose);
    sessionDates.push(bar.sessionDate);
  }

  if (sessionDates.length === 0) {
    throw new StudySessionError("price series has no bars");
  }

  return { sessionDates, adjCloseByDate };
}

export function sessionIndex(
  calendar: SessionCalendar,
  sessionDate: string,
): number | null {
  const idx = calendar.sessionDates.indexOf(sessionDate);
  return idx === -1 ? null : idx;
}

/** N-th forward trading session after entry (1 = next session). */
export function forwardSessionDate(
  calendar: SessionCalendar,
  entrySessionDate: string,
  horizonSessions: number,
): string | null {
  const entryIdx = sessionIndex(calendar, entrySessionDate);
  if (entryIdx === null) return null;
  const exitIdx = entryIdx + horizonSessions;
  if (exitIdx >= calendar.sessionDates.length) return null;
  return calendar.sessionDates[exitIdx] ?? null;
}

/** Count forward sessions available from entry through asOf (inclusive). */
export function forwardSessionsAvailable(
  calendar: SessionCalendar,
  entrySessionDate: string,
  asOfSessionDate: string,
): number {
  const entryIdx = sessionIndex(calendar, entrySessionDate);
  const asOfIdx = sessionIndex(calendar, asOfSessionDate);
  if (entryIdx === null || asOfIdx === null || asOfIdx < entryIdx) {
    return 0;
  }
  return asOfIdx - entryIdx;
}
