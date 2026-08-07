import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/desk/atomic-write";
import type { DailyBar, SymbolBarSeries } from "./types";

/**
 * Local-development bar cache under `data/bars/spy-universe/`.
 * Ephemeral on serverless hosts; do not treat as deployment persistence.
 */

export function spyBarCacheDir(dataRoot: string): string {
  return join(dataRoot, "bars", "spy-universe");
}

export function symbolBarCachePath(dataRoot: string, symbol: string): string {
  return join(spyBarCacheDir(dataRoot), `${symbol}.json`);
}

export function readSymbolBarCache(
  dataRoot: string,
  symbol: string,
): SymbolBarSeries | null {
  const path = symbolBarCachePath(dataRoot, symbol);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SymbolBarSeries;
}

export function writeSymbolBarCache(
  dataRoot: string,
  series: SymbolBarSeries,
): void {
  writeJsonAtomic(symbolBarCachePath(dataRoot, series.symbol), series);
}

export function latestCachedSession(series: SymbolBarSeries | null): string | null {
  return series?.bars.at(-1)?.sessionDate ?? null;
}

export function barsOnSession(
  series: SymbolBarSeries | null,
  sessionDate: string,
): DailyBar | null {
  return series?.bars.find((bar) => bar.sessionDate === sessionDate) ?? null;
}
