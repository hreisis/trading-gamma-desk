/**
 * Deterministic end-to-end study pipeline (M6-4).
 *
 *   npm run studies:pipeline -- --date 2026-07-29 --manifest fixtures/studies/pipeline.m64.json
 *
 * Loads exact PIT archive + price corpus, builds definition/outcomes,
 * similar-regime study, evidence bundle, and validated memo (rule-based by default).
 * No network fetch. Requires explicit --date and --manifest.
 *
 * Optional:
 *   --data-root=data
 *   --repo-root=.
 *   --dry-run
 */

import { parseStudyPipelineArgs, runStudyPipeline } from "../src/studies/run-pipeline";
import { studyPipelineRunPath } from "../src/studies/pipeline-store";

async function main(): Promise<void> {
  const args = parseStudyPipelineArgs(process.argv.slice(2));
  console.log(
    `date: ${args.sessionDate} · manifest: ${args.manifestPath} · write: ${args.dryRun ? "dry-run" : "yes"}`,
  );

  const result = await runStudyPipeline({
    sessionDate: args.sessionDate,
    manifestPath: args.manifestPath,
    repoRoot: args.repoRoot,
    dataRoot: args.dataRoot,
    dryRun: args.dryRun,
  });

  console.log(`studyId: ${result.run.studyId}`);
  console.log(`evidence: ${result.run.evidenceStatus}`);
  console.log(
    `memo: ${result.run.memoStatus} via ${result.run.memoSource} (${result.memo.provider}/${result.memo.model})`,
  );
  if (!args.dryRun) {
    console.log(`run record: ${studyPipelineRunPath(args.dataRoot, args.sessionDate)}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
