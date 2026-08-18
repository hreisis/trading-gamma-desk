/**
 * Session adjacency has to be decided against a calendar of *expected*
 * sessions, not against the calendar. 2 July and 6 July 2026 are adjacent
 * sessions because 3 July was a market holiday; treating them as a gap would
 * discard a valid observation, while treating a genuinely absent session as
 * adjacent would silently bridge two days into one "daily" change.
 */

export interface SessionCalendar {
  isSession(date: string): boolean;
  /** Previous expected session, or null if the calendar cannot reach back. */
  previousSession(date: string): string | null;
  /** Next expected session after `date`, or null if the calendar cannot reach forward. */
  nextSession(date: string): string | null;
}

const MS_PER_DAY = 86_400_000;
const MAX_LOOKBACK_DAYS = 30;

function toUtc(date: string): number {
  const parts = date.split("-");
  if (parts.length !== 3) {
    throw new Error(`invalid session date: ${date}`);
  }
  const [y, m, d] = parts.map(Number) as [number, number, number];
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new Error(`invalid session date: ${date}`);
  }
  const ms = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid session date: ${date}`);
  }
  return ms;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * US equity/Treasury session calendar: weekdays minus the supplied holidays.
 * BTC trades every day, but Milestone 1 snaps it to this calendar so every
 * asset's window uses one session grid.
 */
export function usSessionCalendar(
  holidays: ReadonlySet<string>,
): SessionCalendar {
  function isSession(date: string): boolean {
    const ms = toUtc(date);
    const weekday = new Date(ms).getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    return !holidays.has(date);
  }

  function previousSession(date: string): string | null {
    let ms = toUtc(date);
    for (let i = 0; i < MAX_LOOKBACK_DAYS; i += 1) {
      ms -= MS_PER_DAY;
      const candidate = toIso(ms);
      if (isSession(candidate)) return candidate;
    }
    return null;
  }

  function nextSession(date: string): string | null {
    let ms = toUtc(date);
    for (let i = 0; i < MAX_LOOKBACK_DAYS; i += 1) {
      ms += MS_PER_DAY;
      const candidate = toIso(ms);
      if (isSession(candidate)) return candidate;
    }
    return null;
  }

  return { isSession, previousSession, nextSession };
}

/**
 * Observed US market holidays. The 2026 entries between January and July were
 * reconciled against the gaps in Treasury's published daily yield curve file,
 * which is sparse rather than forward-filled. Later years must be added and
 * re-reconciled the same way; a wrong entry here silently changes which
 * observations count as adjacent.
 */
export const US_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01",
  "2025-01-09",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  // 2026 — the January to July entries match Treasury's published gaps
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

export const defaultSessionCalendar = usSessionCalendar(US_MARKET_HOLIDAYS);
