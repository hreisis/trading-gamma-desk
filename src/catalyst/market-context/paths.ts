import { join } from "node:path";

export const DEFAULT_MARKET_CONTEXT_DATA_ROOT = join(process.cwd(), "data");
export const MARKET_CONTEXT_LATEST_RELATIVE =
  "catalyst/market-context-latest.json";

export function marketContextLatestPath(
  dataRoot: string = DEFAULT_MARKET_CONTEXT_DATA_ROOT,
): string {
  return join(dataRoot, MARKET_CONTEXT_LATEST_RELATIVE);
}
