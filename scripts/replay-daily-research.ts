/**
 * Exact-date offline replay from a stored DailyResearchArchive.
 *
 *   npm run studies:replay -- --date 2026-07-29
 *
 * Optional:
 *   --data-root=data
 *   --fixture=fixtures/studies/archive/2026-07-29/daily-research.json
 *   --verify-only          (validate + determinism check, no stdout payload)
 *
 * No network. Requires explicit --date (no latest fallback).
 */

import {
  dailyResearchArchivePath,
  readDailyResearchArchive,
  verifyArchiveReplay,
} from "../src/studies";

function parseArgs(argv: readonly string[]): {
  date: string;
  dataRoot: string;
  fixture: string | null;
  verifyOnly: boolean;
} {
  let date: string | undefined;
  let dataRoot = "data";
  let fixture: string | null = null;
  let verifyOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--verify-only") {
      verifyOnly = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--date") {
      date = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      fixture = arg.slice("--fixture=".length);
      continue;
    }
    if (arg === "--fixture") {
      fixture = argv[++i] ?? null;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!date) {
    throw new Error("--date is required (exact sessionDate — no latest fallback)");
  }

  return { date, dataRoot, fixture, verifyOnly };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const path =
    args.fixture ?? dailyResearchArchivePath(args.dataRoot, args.date);
  const archive = readDailyResearchArchive(path);

  if (archive.sessionDate !== args.date) {
    throw new Error(
      `archive sessionDate ${archive.sessionDate} != --date ${args.date}`,
    );
  }

  const replayRun = verifyArchiveReplay(archive);

  if (args.verifyOnly) {
    console.log(`verified ${path}`);
    console.log(`archiveId: ${archive.archiveId}`);
    console.log(`eligibility: ${archive.eligibility.status}`);
    console.log(`frames: ${replayRun.frames.length}`);
    return;
  }

  process.stdout.write(JSON.stringify(replayRun, null, 2) + "\n");
  console.error(
    `replayRun ${replayRun.runId} frames=${replayRun.frames.length} eligibility=${archive.eligibility.status}`,
  );
}

main();
