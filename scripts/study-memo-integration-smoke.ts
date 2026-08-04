/**
 * M6-3 study memo integration smoke (manual only).
 *
 *   npm run studies:memo:smoke -- --dry-run --date 2026-07-29
 *   npm run studies:memo:smoke -- --live --dry-run --date 2026-07-29
 *
 * Default uses exact M6-2 evidence bundle fixture. --live requires OPENAI_API_KEY.
 * Report: gitignored data/studies/memo-integration-smoke-latest.json (sanitized).
 */

import {
  formatStudyMemoSmokeSummary,
  parseStudyMemoIntegrationSmokeArgs,
  runStudyMemoIntegrationSmoke,
} from "../src/study-agent/integration-smoke";
import { isPublicDemoMode } from "../src/desk/public-demo";

async function main(): Promise<void> {
  if (isPublicDemoMode()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing study memo integration smoke.",
    );
    process.exit(1);
  }

  const opts = parseStudyMemoIntegrationSmokeArgs(process.argv.slice(2));
  console.log(
    `mode: ${opts.live ? "live" : "plan"} · memo-write: ${opts.dryRun ? "dry-run" : "write"} · date: ${opts.date}`,
  );

  const result = await runStudyMemoIntegrationSmoke({
    ...opts,
    live: opts.live,
    dryRun: opts.dryRun,
  });

  for (const line of formatStudyMemoSmokeSummary(result.report)) {
    console.log(line);
  }
  if (result.reportPath) {
    console.log(`report: ${result.reportPath}`);
  }
  if (result.report.errors.length > 0) {
    console.log(`errors: ${result.report.errors.length}`);
  }
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
