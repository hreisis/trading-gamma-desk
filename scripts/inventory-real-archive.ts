/**
 * Inventory locally available real archive candidate sessions.
 *
 *   npm run studies:inventory-archive -- --through YYYY-MM-DD
 *
 * Parses and validates data/drivers/*.json — never infers eligibility from filenames alone.
 * No network. No latest-fallback.
 */

import { inventoryRealArchiveSessions, parseInventoryArgs } from "../src/studies/real-archive/inventory";

function main(): void {
  const { throughDate, dataRoot } = parseInventoryArgs(process.argv.slice(2));
  const report = inventoryRealArchiveSessions({ throughDate, dataRoot });

  console.log(`throughDate:                 ${report.throughDate}`);
  console.log(`candidateSessions:           ${report.summary.candidateSessions}`);
  console.log(`eligible:                    ${report.summary.eligible}`);
  console.log(`partial:                     ${report.summary.partial}`);
  console.log(`ineligible:                  ${report.summary.ineligible}`);
  console.log(`invalid:                     ${report.summary.invalid}`);
  console.log(
    `exactDateStructureSessions:  ${report.summary.exactDateStructureSessions}`,
  );
  console.log(`catalystPitSessions:         ${report.summary.catalystPitSessions}`);
  console.log("");
  console.log("Exclusion reason counts:");
  for (const [reason, count] of Object.entries(report.exclusionReasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log("");
  for (const entry of report.entries) {
    console.log(
      `${entry.sessionDate}  ${entry.classification.padEnd(11)}  ${entry.exclusionReasons.join("; ") || "(none)"}`,
    );
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
