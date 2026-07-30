import { join } from "node:path";

export const DEFAULT_DOCUMENTS_DATA_ROOT = join(process.cwd(), "data");
export const DOCUMENTS_LATEST_RELATIVE = "catalyst/documents-latest.json";

export function documentsLatestPath(
  dataRoot: string = DEFAULT_DOCUMENTS_DATA_ROOT,
): string {
  return join(dataRoot, DOCUMENTS_LATEST_RELATIVE);
}
