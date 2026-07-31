/**
 * Parse ISO-8601 timestamps to UTC epoch milliseconds for ordering.
 * Never compare asOf values by raw string order — offsets can sort incorrectly.
 */
export function parseIsoInstantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid ISO instant: ${iso}`);
  }
  return ms;
}

export function compareIsoInstants(a: string, b: string): number {
  return parseIsoInstantMs(a) - parseIsoInstantMs(b);
}
