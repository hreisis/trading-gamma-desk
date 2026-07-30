import { join } from "node:path";

export const DEFAULT_BRIEFS_DATA_ROOT = join(process.cwd(), "data");
export const BRIEFS_LATEST_RELATIVE = "catalyst/briefs-latest.json";

export function briefsLatestPath(
  dataRoot: string = DEFAULT_BRIEFS_DATA_ROOT,
): string {
  return join(dataRoot, BRIEFS_LATEST_RELATIVE);
}
