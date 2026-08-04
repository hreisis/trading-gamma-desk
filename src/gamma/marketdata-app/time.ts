/**
 * Market-session calendar helpers for MarketData.app vendor timestamps.
 * America/New_York — matches expiration date conversion in normalize.ts.
 */

export function unixSecToIso(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString();
}

export function sessionDateFromUnixSec(unixSec: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unixSec * 1000));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`unusable vendor timestamp: ${unixSec}`);
  }
  return `${year}-${month}-${day}`;
}

export function sessionDateFromIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`unusable ISO instant: ${iso}`);
  }
  return sessionDateFromUnixSec(Math.floor(ms / 1000));
}

/** Calendar DTE between sessionDate and expiration (YYYY-MM-DD), ET noon anchors. */
export function calendarDte(sessionDate: string, expiration: string): number {
  const s = Date.parse(`${sessionDate}T12:00:00-04:00`);
  const e = Date.parse(`${expiration}T12:00:00-04:00`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    throw new Error(
      `unusable sessionDate/expiration for DTE: ${sessionDate} / ${expiration}`,
    );
  }
  const days = Math.round((e - s) / 86_400_000);
  if (days < 0) {
    throw new Error(
      `expiration ${expiration} is before sessionDate ${sessionDate}`,
    );
  }
  return days;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveUnixInts(values: readonly unknown[]): number[] {
  const nums = values.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0 || !Number.isInteger(n))) {
    throw new Error("vendor updated timestamps are unusable");
  }
  return nums;
}

function rangeFromUnix(nums: readonly number[]): {
  minUnix: number;
  maxUnix: number;
  minIso: string;
  maxIso: string;
} {
  const minUnix = Math.min(...nums);
  const maxUnix = Math.max(...nums);
  return {
    minUnix,
    maxUnix,
    minIso: unixSecToIso(minUnix),
    maxIso: unixSecToIso(maxUnix),
  };
}

function readParallelUpdatedTimestamps(body: Record<string, unknown>): number[] {
  const optionSymbol = body.optionSymbol;
  const rowCount = Array.isArray(optionSymbol) ? optionSymbol.length : 0;
  if (rowCount === 0) return [];

  const updated = body.updated;
  if (!Array.isArray(updated) || updated.length !== rowCount) {
    return [];
  }
  return parsePositiveUnixInts(updated);
}

/**
 * Read vendor freshness timestamps without inventing wall-clock asOf.
 * Accepts scalar metadata `updated` (expirations endpoint) or parallel-array
 * per-contract timestamps (options chain). Never accepts missing/empty data.
 */
export function extractVendorUpdatedRange(body: unknown): {
  minUnix: number;
  maxUnix: number;
  minIso: string;
  maxIso: string;
} {
  if (!isRecord(body)) {
    throw new Error("vendor body must be an object to read updated timestamps");
  }

  const updated = body.updated;
  if (
    typeof updated === "number" &&
    Number.isFinite(updated) &&
    updated > 0 &&
    Number.isInteger(updated)
  ) {
    return rangeFromUnix([updated]);
  }

  if (Array.isArray(updated) && updated.length > 0) {
    return rangeFromUnix(parsePositiveUnixInts(updated));
  }

  const rowUpdated = readParallelUpdatedTimestamps(body);
  if (rowUpdated.length > 0) {
    return rangeFromUnix(rowUpdated);
  }

  throw new Error("vendor updated timestamps absent or empty");
}

export function defaultBoundedExpiration(sessionDate: string): string {
  return sessionDateFromIso(
    new Date(Date.parse(`${sessionDate}T12:00:00-04:00`) + 86_400_000).toISOString(),
  );
}
