import { join } from "node:path";

export const DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT = join(
  process.cwd(),
  "data",
);
export const AI_MARKET_REACTIONS_LATEST_RELATIVE =
  "catalyst/ai-market-reactions-latest.json";

export function aiMarketReactionsLatestPath(
  dataRoot: string = DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
): string {
  return join(dataRoot, AI_MARKET_REACTIONS_LATEST_RELATIVE);
}
