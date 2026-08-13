import { join } from "node:path";

export const DEFAULT_BOUNDED_GAMMA_DATA_ROOT = join(
  process.cwd(),
  "data",
  "gamma",
  "providers",
  "marketdata-app",
);

/** Relative durable-artifact path under data/ or blob desk/ prefix. */
export function boundedGammaArtifactRelativePath(symbol: string): string {
  const safe = symbol.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "_");
  return `gamma/providers/marketdata-app/${safe}-bounded-latest.json`;
}

/** Deterministic latest path for a symbol's bounded provider snapshot. */
export function boundedGammaLatestPath(
  symbol: string,
  dataRoot: string = DEFAULT_BOUNDED_GAMMA_DATA_ROOT,
): string {
  const safe = symbol.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "_");
  return join(dataRoot, `${safe}-bounded-latest.json`);
}
