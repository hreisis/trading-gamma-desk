/**
 * Build non-synthetic DailyResearchArchive entries and peer corpus from local data/.
 *
 *   npm run studies:build-archive -- --through YYYY-MM-DD
 *
 * Writes:
 *   data/studies/archive/{sessionDate}/daily-research.json  (eligible only)
 *   data/studies/profiles/{throughDate}/peer-corpus.json
 *
 * Requires explicit PIT cutoff. No network. No latest-fallback.
 */

import { buildRealArchives, parseBuildArchiveArgs } from "../src/studies/real-archive/build-archives";

function main(): void {
  const { throughDate, dataRoot, dryRun } = parseBuildArchiveArgs(
    process.argv.slice(2),
  );
  const result = buildRealArchives({ throughDate, dataRoot, dryRun });

  console.log(`throughDate:           ${throughDate}`);
  console.log(`dryRun:                ${dryRun}`);
  console.log(`candidateSessions:     ${result.inventory.summary.candidateSessions}`);
  console.log(`eligibleBuilt:         ${result.builtSessionDates.length}`);
  console.log(`skipped:               ${result.skippedSessionDates.length}`);
  console.log(
    `exactDateStructure:    ${result.inventory.summary.exactDateStructureSessions}/${result.inventory.summary.candidateSessions}`,
  );
  console.log(
    `catalystPitSessions:   ${result.inventory.summary.catalystPitSessions}/${result.inventory.summary.candidateSessions}`,
  );
  console.log(`peerCorpusSize:        ${result.corpus.included.length}`);
  console.log(`matchingViable:        ${result.corpus.coverage.matchingViable}`);
  console.log(`matchingNote:          ${result.corpus.coverage.matchingViableNote}`);
  console.log("");
  if (result.builtSessionDates.length > 0) {
    console.log("Built archive dates:");
    for (const d of result.builtSessionDates) {
      console.log(`  data/studies/archive/${d}/daily-research.json`);
    }
  }
  if (!dryRun) {
    console.log(`peerCorpus:            ${result.corpusPath}`);
  }
  console.log("");
  console.log("Exclusion reason counts:");
  for (const [reason, count] of Object.entries(
    result.inventory.exclusionReasonCounts,
  ).sort()) {
    console.log(`  ${reason}: ${count}`);
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
