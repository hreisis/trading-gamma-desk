/**
 * Template interpretation over an existing compute snapshot.
 *
 *   npm run interpret
 *   npm run interpret -- 2026-07-29
 *
 * Reads data/snapshots/<session>.json, does not re-score, does not call an
 * LLM, and writes data/drivers/<session>.json as a contract-valid
 * DominantDriver. Requires a prior `npm run ingest`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MacroSnapshot } from "../src/ingest";
import { interpretSnapshot } from "../src/interpret";

function latestSnapshotSession(root: string): string {
  const dir = join(root, "snapshots");
  if (!existsSync(dir)) {
    throw new Error(`no snapshots under ${dir}; run npm run ingest first`);
  }
  const sessions = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
  const latest = sessions.at(-1);
  if (!latest) {
    throw new Error(`no snapshots under ${dir}; run npm run ingest first`);
  }
  return latest;
}

function main(): void {
  const root = "data";
  const arg = process.argv[2];
  const session =
    arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)
      ? arg
      : latestSnapshotSession(root);

  const snapshotPath = join(root, "snapshots", `${session}.json`);
  if (!existsSync(snapshotPath)) {
    throw new Error(`missing snapshot ${snapshotPath}`);
  }

  const snapshot = JSON.parse(
    readFileSync(snapshotPath, "utf8"),
  ) as MacroSnapshot;

  const driver = interpretSnapshot(snapshot);

  const outDir = join(root, "drivers");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${session}.json`);
  writeFileSync(outPath, JSON.stringify(driver, null, 2) + "\n");

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
  console.log(`driver:         ${outPath}`);
}

main();
