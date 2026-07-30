/**
 * Local-first macro ingest.
 *
 *   npm run ingest
 *   npm run ingest -- --force
 *
 * Pulls Treasury, CBOE VIX and Tiingo (ETF proxies + BTC), persists raw bars
 * under data/bars/, and writes an immutable compute snapshot under
 * data/snapshots/. Requires TIINGO_TOKEN in .env. Never prints the token.
 */

import { runMacroIngest, DEFAULT_DATA_ROOT } from "../src/ingest";

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
  const result = await runMacroIngest({
    dataRoot: DEFAULT_DATA_ROOT,
    force,
  });

  const { snapshot } = result;
  console.log(`marketSessionDate: ${snapshot.marketSessionDate}`);
  console.log(`generatedAt:       ${snapshot.generatedAt}`);
  console.log(`sessionAlignment:  ${snapshot.sessionAlignment}`);
  console.log(`isCompleteSession: ${snapshot.isCompleteSession}`);
  console.log(
    `regime:            ${snapshot.classification.primaryRegime}` +
      (snapshot.classification.polarity
        ? ` / ${snapshot.classification.polarity}`
        : ""),
  );
  console.log(
    `confidence:        ${snapshot.classification.confidence.score}/100` +
      (snapshot.classification.confidence.calibrated
        ? ""
        : " (uncalibrated)"),
  );
  console.log(`snapshot:          ${result.snapshotPath}`);
  console.log(
    `bars:              ${result.barPaths.length} series under ${DEFAULT_DATA_ROOT}/bars/`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
