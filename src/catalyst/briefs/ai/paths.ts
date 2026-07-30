import { join } from "node:path";

export const DEFAULT_AI_BRIEFS_DATA_ROOT = join(process.cwd(), "data");
export const AI_BRIEFS_LATEST_RELATIVE = "catalyst/ai-briefs-latest.json";

export function aiBriefsLatestPath(
  dataRoot: string = DEFAULT_AI_BRIEFS_DATA_ROOT,
): string {
  return join(dataRoot, AI_BRIEFS_LATEST_RELATIVE);
}
