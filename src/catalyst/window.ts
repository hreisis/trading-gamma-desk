import { compareInstant, instantMs, toUtcIsoZ } from "./time";

/** Default retention: now − 1 day … now + 45 days (injectable `now`). */
export const DEFAULT_LOOKBACK_MS = 1 * 24 * 60 * 60 * 1000;
export const DEFAULT_LOOKAHEAD_MS = 45 * 24 * 60 * 60 * 1000;

export interface CatalystTimeWindow {
  readonly now: string;
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function buildTimeWindow(
  now: Date,
  options: {
    readonly lookbackMs?: number;
    readonly lookaheadMs?: number;
  } = {},
): CatalystTimeWindow {
  const lookback = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const lookahead = options.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS;
  const nowMs = now.getTime();
  const startMs = nowMs - lookback;
  const endMs = nowMs + lookahead;
  return {
    now: new Date(nowMs).toISOString(),
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

/** Inclusive window membership by epoch ms. */
export function isInTimeWindow(
  occurredAt: string,
  window: CatalystTimeWindow,
): boolean {
  const ms = instantMs(occurredAt);
  if (ms === null) return false;
  return ms >= window.startMs && ms <= window.endMs;
}

/**
 * Sort key for same-instant deterministic ordering: occurredAt desc, then id asc.
 * (Used after normalize; adapters may pre-sort raw rows similarly.)
 */
export function compareOccurredThenId(
  a: { readonly occurredAt: string; readonly id?: string; readonly externalId?: string },
  b: { readonly occurredAt: string; readonly id?: string; readonly externalId?: string },
): number {
  const byOccurred = compareInstant(b.occurredAt, a.occurredAt);
  if (byOccurred !== 0) return byOccurred;
  const aKey = a.id ?? a.externalId ?? toUtcIsoZ(a.occurredAt) ?? "";
  const bKey = b.id ?? b.externalId ?? toUtcIsoZ(b.occurredAt) ?? "";
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}
