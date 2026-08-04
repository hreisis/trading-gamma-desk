import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/desk/atomic-write";
import type { RawBar } from "./types";

export const SPY_SYMBOL = "SPY" as const;
export const SPY_INSTRUMENT = "SPY";
export const SPY_VENDOR_SOURCE = "tiingo/daily/spy";

export interface SpyBarSeries {
  readonly symbol: typeof SPY_SYMBOL;
  readonly instrument: string;
  readonly isProxy: false;
  readonly source: string;
  readonly writtenAt: string;
  readonly bars: readonly RawBar[];
}

export function spyBarsRelPath(): string {
  return join("bars", `${SPY_SYMBOL}.json`);
}

export function spyBarsPath(root: string): string {
  return join(root, spyBarsRelPath());
}

export function writeSpyBars(
  series: Omit<SpyBarSeries, "writtenAt">,
  root: string,
): string {
  const path = spyBarsPath(root);
  writeJsonAtomic(path, {
    ...series,
    writtenAt: new Date().toISOString(),
  });
  return path;
}

export function readSpyBars(root: string): SpyBarSeries {
  const path = spyBarsPath(root);
  if (!existsSync(path)) {
    throw new Error(`no cached SPY bars at ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as SpyBarSeries;
  if (raw.symbol !== SPY_SYMBOL) {
    throw new Error(`expected SPY bars at ${path}, got symbol ${raw.symbol}`);
  }
  return raw;
}
