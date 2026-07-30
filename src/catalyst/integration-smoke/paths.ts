import { join } from "node:path";

export const DEFAULT_INTEGRATION_SMOKE_DATA_ROOT = join(process.cwd(), "data");

export const INTEGRATION_SMOKE_REPORT_RELATIVE =
  "catalyst/integration-smoke-latest.json";

export function integrationSmokeReportPath(
  dataRoot: string = DEFAULT_INTEGRATION_SMOKE_DATA_ROOT,
): string {
  return join(dataRoot, INTEGRATION_SMOKE_REPORT_RELATIVE);
}
