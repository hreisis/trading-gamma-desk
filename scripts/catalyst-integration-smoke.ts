/**
 * M2-5A-Lite integration smoke (manual only).
 *
 *   npm run catalyst:integration:smoke -- --dry-run
 *   npm run catalyst:integration:smoke -- --live --max-events 2
 *
 * Default is plan-only (no provider calls). Explicit --live required for OpenAI.
 * Alpaca remains awaiting_credentials / awaiting_live_smoke when keys missing.
 * Never a daily pipeline / scheduler.
 */

import {
  formatSummary,
  parseIntegrationSmokeArgs,
  runCatalystIntegrationSmoke,
} from "../src/catalyst/integration-smoke";
import { isPublicDemoMode } from "../src/desk/public-demo";

async function main(): Promise<void> {
  if (isPublicDemoMode()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing integration smoke.",
    );
    process.exit(1);
  }

  const opts = parseIntegrationSmokeArgs(process.argv.slice(2));
  console.log(
    `mode: ${opts.live && !opts.dryRun ? "live" : "dry-run"} · max-events: ${opts.maxEvents ?? 2} · update-cache: ${Boolean(opts.updateCache)}`,
  );

  const result = await runCatalystIntegrationSmoke(opts);
  for (const line of formatSummary(result.report)) {
    console.log(line);
  }
  if (result.reportPath) {
    console.log(`report: ${result.reportPath}`);
  }
  for (const note of result.report.notes.slice(0, 8)) {
    console.log(`  · ${note}`);
  }
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
