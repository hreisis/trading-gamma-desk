import { join } from "node:path";

export const DEFAULT_STUDY_MEMO_SMOKE_DATA_ROOT = "data";

export function studyMemoIntegrationSmokeReportPath(
  dataRoot: string = DEFAULT_STUDY_MEMO_SMOKE_DATA_ROOT,
): string {
  return join(dataRoot, "studies", "memo-integration-smoke-latest.json");
}
