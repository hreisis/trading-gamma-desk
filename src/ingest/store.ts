import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MacroSymbol } from "@/contracts";
import type { SymbolSeries } from "./types";

export const DEFAULT_DATA_ROOT = "data";

export function barsPath(
  root: string,
  symbol: MacroSymbol,
): string {
  return join(root, "bars", `${symbol}.json`);
}

export function snapshotPath(root: string, marketSessionDate: string): string {
  return join(root, "snapshots", `${marketSessionDate}.json`);
}

/** Persist one symbol's bars. Overwrites the series file for that symbol. */
export function writeBars(
  series: SymbolSeries,
  root: string = DEFAULT_DATA_ROOT,
): string {
  const path = barsPath(root, series.symbol);
  mkdirSync(join(root, "bars"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        symbol: series.symbol,
        instrument: series.instrument,
        isProxy: series.isProxy,
        source: series.source,
        writtenAt: new Date().toISOString(),
        bars: series.bars,
      },
      null,
      2,
    ) + "\n",
  );
  return path;
}

export function readBars(
  symbol: MacroSymbol,
  root: string = DEFAULT_DATA_ROOT,
): SymbolSeries {
  const path = barsPath(root, symbol);
  if (!existsSync(path)) {
    throw new Error(`no cached bars for ${symbol} at ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as SymbolSeries;
  return {
    symbol: raw.symbol,
    instrument: raw.instrument,
    isProxy: raw.isProxy,
    source: raw.source,
    bars: raw.bars,
  };
}

/**
 * Write an immutable snapshot. Refuses to overwrite an existing file so a
 * past conclusion cannot be silently rewritten after weights change — bump
 * the path or delete deliberately if a recompute is intentional.
 */
export function writeSnapshot(
  marketSessionDate: string,
  payload: unknown,
  root: string = DEFAULT_DATA_ROOT,
): string {
  const path = snapshotPath(root, marketSessionDate);
  mkdirSync(join(root, "snapshots"), { recursive: true });
  if (existsSync(path)) {
    throw new Error(
      `snapshot already exists at ${path}; delete it explicitly to recompute`,
    );
  }
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
  return path;
}
