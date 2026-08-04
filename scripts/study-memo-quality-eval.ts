#!/usr/bin/env tsx
import { writeEvalFixtures } from "@/study-agent/eval-fixtures";
import {
  formatStudyMemoEvalSummary,
  runStudyMemoQualityEval,
} from "@/study-agent/study-memo-eval";

async function main(): Promise<void> {
  writeEvalFixtures();
  const report = await runStudyMemoQualityEval({ writeReport: true });
  for (const line of formatStudyMemoEvalSummary(report)) {
    console.log(line);
  }
  console.log("");
  console.log(
    `report: data/studies/evals/study-memo-quality-latest.json (runId=${report.runId})`,
  );
  const failed = report.cases.filter((c) => !c.overallHardPass);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]"));
  process.exit(1);
});
