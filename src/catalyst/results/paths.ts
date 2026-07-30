import { join } from "node:path";

export const DEFAULT_RESULTS_DATA_ROOT = join(process.cwd(), "data");
export const RESULTS_LATEST_RELATIVE = "catalyst/results-latest.json";

export function resultsLatestPath(
  dataRoot: string = DEFAULT_RESULTS_DATA_ROOT,
): string {
  return join(dataRoot, RESULTS_LATEST_RELATIVE);
}
