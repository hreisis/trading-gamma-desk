/**
 * Build a PIT-safe DailyResearchArchive from a local manifest (fixtures or data/).
 *
 *   npm run studies:build -- --date 2026-07-29 --manifest fixtures/studies/sources.m51b.json
 *
 * Optional:
 *   --data-root=data          (default data)
 *   --repo-root=.             (default cwd)
 *   --dry-run                 (print JSON to stdout, no write)
 *
 * Writes: data/studies/archive/{date}/daily-research.json (gitignored)
 * No network. No latest-fallback. Exact sessionDate + manifest IDs only.
 */

import {
  buildDailyResearchArchive,
  dailyResearchArchivePath,
  loadStudySourcesFromFile,
  writeDailyResearchArchive,
} from "../src/studies";

function parseArgs(argv: readonly string[]): {
  date: string;
  manifest: string;
  dataRoot: string;
  repoRoot: string;
  dryRun: boolean;
} {
  let date: string | undefined;
  let manifest: string | undefined;
  let dataRoot = "data";
  let repoRoot = process.cwd();
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
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
    if (arg.startsWith("--manifest=")) {
      manifest = arg.slice("--manifest=".length);
      continue;
    }
    if (arg === "--manifest") {
      manifest = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-root=")) {
      dataRoot = arg.slice("--data-root=".length);
      continue;
    }
    if (arg.startsWith("--repo-root=")) {
      repoRoot = arg.slice("--repo-root=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!date) {
    throw new Error("--date is required (exact sessionDate — no latest fallback)");
  }
  if (!manifest) {
    throw new Error("--manifest is required");
  }

  return { date, manifest, dataRoot, repoRoot, dryRun };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadStudySourcesFromFile(args.manifest, args.repoRoot);

  if (loaded.manifest.sessionDate !== args.date) {
    throw new Error(
      `manifest sessionDate ${loaded.manifest.sessionDate} != --date ${args.date}`,
    );
  }

  const archive = buildDailyResearchArchive({
    sessionDate: loaded.manifest.sessionDate,
    runId: loaded.manifest.runId,
    builtAt: loaded.manifest.builtAt,
    evaluationInstants: loaded.manifest.evaluationInstants,
    corpus: loaded.corpus,
    components: loaded.components,
  });

  if (args.dryRun) {
    process.stdout.write(JSON.stringify(archive, null, 2) + "\n");
    console.error(
      `dry-run: eligibility=${archive.eligibility.status} frames=${archive.replayRun.frames.length}`,
    );
    return;
  }

  const outPath = dailyResearchArchivePath(args.dataRoot, args.date);
  writeDailyResearchArchive(outPath, archive);
  console.log(`wrote ${outPath}`);
  console.log(`archiveId: ${archive.archiveId}`);
  console.log(`eligibility: ${archive.eligibility.status}`);
  console.log(`frames: ${archive.replayRun.frames.length}`);
}

main();
