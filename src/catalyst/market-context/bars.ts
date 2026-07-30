export interface RawMarketBar {
  readonly t: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v?: number;
  readonly n?: number;
  readonly vw?: number;
}

export interface NormalizedBar {
  readonly timestampMs: number;
  readonly timestamp: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface NormalizeBarsResult {
  readonly bars: NormalizedBar[];
  readonly warnings: string[];
}

function toIsoZ(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Validate, dedupe, and sort bars ascending by timestamp.
 * Duplicate timestamps keep the last occurrence. Out-of-order input is sorted.
 */
export function normalizeBars(
  raw: readonly RawMarketBar[],
): NormalizeBarsResult {
  const warnings: string[] = [];
  const byMs = new Map<number, NormalizedBar>();

  for (let i = 0; i < raw.length; i += 1) {
    const bar = raw[i]!;
    const ms = Date.parse(bar.t);
    if (!Number.isFinite(ms)) {
      warnings.push(`malformed bar timestamp at index ${i}`);
      continue;
    }
    if (
      ![bar.o, bar.h, bar.l, bar.c].every((x) => Number.isFinite(x))
    ) {
      warnings.push(`malformed bar OHLC at index ${i}`);
      continue;
    }
    if (byMs.has(ms)) {
      warnings.push(`duplicate bar at ${toIsoZ(ms)} — keeping last`);
    }
    byMs.set(ms, {
      timestampMs: ms,
      timestamp: toIsoZ(ms),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    });
  }

  const bars = [...byMs.values()].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );
  return { bars, warnings };
}

/** Last bar strictly before eventMs within lookbackMs. Never look-ahead. */
export function findBaselineBar(
  bars: readonly NormalizedBar[],
  eventMs: number,
  lookbackMs: number,
): NormalizedBar | null {
  const earliest = eventMs - lookbackMs;
  let best: NormalizedBar | null = null;
  for (const bar of bars) {
    if (bar.timestampMs >= eventMs) break;
    if (bar.timestampMs < earliest) continue;
    best = bar;
  }
  return best;
}

/**
 * First bar at or after targetMs, within slackMs. Returns null if none.
 */
export function findWindowBar(
  bars: readonly NormalizedBar[],
  targetMs: number,
  slackMs: number,
): NormalizedBar | null {
  for (const bar of bars) {
    if (bar.timestampMs < targetMs) continue;
    if (bar.timestampMs > targetMs + slackMs) return null;
    return bar;
  }
  return null;
}

/**
 * Last bar with timestamp < sessionCloseUtc (bar starts before close).
 * For 1Min bars, the 15:59 ET bar is the last full minute before 16:00.
 */
export function findSessionCloseBar(
  bars: readonly NormalizedBar[],
  sessionCloseUtc: Date,
): NormalizedBar | null {
  const closeMs = sessionCloseUtc.getTime();
  let best: NormalizedBar | null = null;
  for (const bar of bars) {
    if (bar.timestampMs >= closeMs) break;
    // Only accept bars on/after open-ish within the session day window:
    // caller should already filter the fetch range.
    best = bar;
  }
  return best;
}
