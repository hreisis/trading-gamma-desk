/**
 * Template interpretation over an existing compute snapshot.
 *
 *   npm run interpret
 *   npm run interpret -- 2026-07-29
 *
 * Reads data/snapshots/<session>.json, does not re-score, does not call an
 * LLM, and atomically writes data/drivers/<session>.json. Requires a prior
 * `npm run ingest`. On failure the previous driver file is left untouched.
 */

import { interpretAndWriteDriver } from "../src/pipeline";

function main(): void {
  const arg = process.argv[2];
  const session =
    arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined;

  const result = interpretAndWriteDriver({
    dataRoot: "data",
    session,
    updatePipelineStatus: true,
  });

  const { driver } = result;
  console.log(`session:        ${driver.marketSessionDate}`);
  console.log(
    `regime:         ${driver.primaryRegime}` +
      (driver.polarity ? ` / ${driver.polarity}` : ""),
  );
  console.log(
    `confidence:     ${driver.confidence.score}/100` +
      (driver.confidence.calibrated ? "" : " (uncalibrated)"),
  );
  console.log(`generator:      ${driver.interpretation.generator}`);
  console.log(`interpretation: ${driver.interpretation.text}`);
  console.log(`driver:         ${result.driverPath}`);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(
    "Previous valid driver (if any) was kept. See data/pipeline/status.json.",
  );
  process.exit(1);
}
