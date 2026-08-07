export interface DailyBar {
  readonly sessionDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface SymbolBarSeries {
  readonly symbol: string;
  readonly bars: readonly DailyBar[];
  readonly updatedAt: string;
}

export interface AlpacaRawBar {
  readonly t: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}

export function sessionDateFromBarTimestamp(iso: string): string {
  return iso.slice(0, 10);
}

export function mapAlpacaBar(bar: AlpacaRawBar): DailyBar {
  return {
    sessionDate: sessionDateFromBarTimestamp(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

export function mergeBarSeries(
  existing: readonly DailyBar[],
  incoming: readonly DailyBar[],
): DailyBar[] {
  const byDate = new Map<string, DailyBar>();
  for (const bar of existing) byDate.set(bar.sessionDate, bar);
  for (const bar of incoming) byDate.set(bar.sessionDate, bar);
  return [...byDate.values()].sort((a, b) =>
    a.sessionDate.localeCompare(b.sessionDate),
  );
}
