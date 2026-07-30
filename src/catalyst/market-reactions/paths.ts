import { join } from "node:path";

export const DEFAULT_MARKET_REACTIONS_DATA_ROOT = join(process.cwd(), "data");
export const MARKET_REACTIONS_LATEST_RELATIVE =
  "catalyst/market-reactions-latest.json";

export function marketReactionsLatestPath(
  dataRoot: string = DEFAULT_MARKET_REACTIONS_DATA_ROOT,
): string {
  return join(dataRoot, MARKET_REACTIONS_LATEST_RELATIVE);
}
