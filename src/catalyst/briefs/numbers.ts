/**
 * Numeric parsing helpers for official release prose.
 * Preserves source display precision (no invented trailing zeros).
 */

export function parseSignedNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/,/g, "")
    .replace(/^\((.+)\)$/, "-$1");
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a percent / percentage-point token, including "unchanged" → 0.
 */
export function parsePercentToken(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (t === "unchanged" || t === "little changed" || t === "changed little") {
    return 0;
  }
  const m = t.match(/^([+-]?\(?[\d,]*\.?\d+\)?)/);
  if (!m) return null;
  return parseSignedNumber(m[1]!);
}

export function parseBillionToken(raw: string): number | null {
  const n = parseSignedNumber(raw.replace(/\$/g, ""));
  return n;
}

/** Format a number using the source token's decimal places when possible. */
export function sourceDisplayNumber(rawToken: string, value: number): string {
  const token = rawToken.replace(/,/g, "").replace(/[()]/g, "");
  const dot = token.indexOf(".");
  if (dot >= 0) {
    const decimals = token.length - dot - 1;
    return value.toFixed(Math.min(Math.max(decimals, 0), 6));
  }
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

export interface RangePair {
  readonly low: number;
  readonly high: number;
  readonly excerpt: string;
}

export function parseTargetRange(
  text: string,
): RangePair | null {
  const m = text.match(
    /(\d(?:\.\d+)?)\s*(?:to|–|-)\s*(\d(?:\.\d+)?)\s*percent/i,
  );
  if (!m) return null;
  const low = parseSignedNumber(m[1]!);
  const high = parseSignedNumber(m[2]!);
  if (low === null || high === null) return null;
  return { low, high, excerpt: m[0]! };
}
