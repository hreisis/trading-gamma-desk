/**
 * Daily Macro desk refresh.
 *
 *   npm run daily
 *   npm run daily -- --force
 *
 * Sequence: ingest (pull + compute snapshot) → interpret → atomic driver write.
 * On failure the previous valid driver is left in place and
 * data/pipeline/status.json records the error for the desk UI.
 */

import { DEFAULT_DATA_ROOT } from "../src/ingest";
import { runDailyPipeline } from "../src/pipeline";

function tokenPresent(): boolean {
  const raw = (process.env.TIINGO_TOKEN ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return raw.length > 0;
}

async function main(): Promise<void> {
  if (!tokenPresent()) {
    console.error(
      "TIINGO_TOKEN is empty. Put a token in .env (see .env.example) and re-run.",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const result = await runDailyPipeline({
    dataRoot: DEFAULT_DATA_ROOT,
    force,
  });

  const { driver } = result.interpret;
  console.log(`marketSessionDate: ${driver.marketSessionDate}`);
  console.log(`sessionAlignment:  ${driver.sessionAlignment}`);
  console.log(`isCompleteSession: ${driver.isCompleteSession}`);
  console.log(
    `regime:            ${driver.primaryRegime}` +
      (driver.polarity ? ` / ${driver.polarity}` : ""),
  );
  console.log(
    `confidence:        ${driver.confidence.score}/100` +
      (driver.confidence.calibrated ? "" : " (uncalibrated)"),
  );
  console.log(`snapshot:          ${result.ingest.snapshotPath}`);
  console.log(`driver:            ${result.interpret.driverPath}`);
  console.log(
    `pipeline:          ok (ingest → compute → interpret → atomic write)`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`daily pipeline failed: ${message}`);
  console.error(
    "Previous valid driver (if any) was kept. Desk UI should show stale/error.",
  );
  process.exit(1);
});
