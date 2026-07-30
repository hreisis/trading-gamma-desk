/**
 * Instant helpers for catalyst timestamps.
 * All comparisons use epoch ms; canonical output is UTC `…Z` (ISO with ms).
 */

/** Parse any Date-parseable string to epoch ms, or null. */
export function instantMs(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Canonical UTC ISO-8601 with Z. Same instant always yields the same string.
 * Returns null when unparseable.
 */
export function toUtcIsoZ(raw: string): string | null {
  const ms = instantMs(raw);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

/** Compare two instant strings by true time. Negative if a < b. */
export function compareInstant(a: string, b: string): number {
  const am = instantMs(a);
  const bm = instantMs(b);
  if (am === null && bm === null) return 0;
  if (am === null) return -1;
  if (bm === null) return 1;
  return am === bm ? 0 : am < bm ? -1 : 1;
}

/** UTC calendar day YYYY-MM-DD for an instant string. */
export function utcDay(raw: string): string | null {
  const z = toUtcIsoZ(raw);
  return z ? z.slice(0, 10) : null;
}
