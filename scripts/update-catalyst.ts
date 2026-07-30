/**
 * M2-5B unified incremental catalyst update (manual only).
 *
 *   npm run catalyst:update
 *   npm run catalyst:update -- --dry-run
 *   npm run catalyst:update -- --max-events 2
 *   npm run catalyst:update -- --force --max-events 2
 *
 * Orchestrates official facts → AI brief and 4A → 4B → 4C with identity-based
 * incremental skips, run lock, and a sanitized gitignored manifest.
 * Not a scheduler. Public demo refuses this command.
 */

import {
  formatUpdateSummary,
  parseCatalystUpdateArgs,
  runCatalystUpdate,
} from "../src/catalyst/update";
import { isPublicDemoMode } from "../src/desk/public-demo";

async function main(): Promise<void> {
  if (isPublicDemoMode()) {
    console.error("GAMMADESK_PUBLIC_DEMO is set — refusing catalyst:update.");
    process.exit(1);
  }

  const opts = parseCatalystUpdateArgs(process.argv.slice(2));
  console.log(
    `mode: ${opts.dryRun ? "dry-run" : "live"} · max-events: ${opts.maxEvents ?? 2} · force: ${Boolean(opts.force)}`,
  );

  const result = await runCatalystUpdate(opts);
  for (const line of formatUpdateSummary(result.manifest)) {
    console.log(line);
  }
  if (result.manifestPath) {
    console.log(`manifest: ${result.manifestPath}`);
  }
  for (const note of result.manifest.notes.slice(0, 10)) {
    console.log(`  · ${note}`);
  }
  process.exit(result.exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
