/**
 * Build a constrained study memo from an exact StudyEvidenceBundle file.
 *
 *   npm run studies:memo -- --date 2026-07-29 --bundle fixtures/studies/evidence-bundle.m62.json
 *
 * Uses OpenAI when OPENAI_API_KEY is set; otherwise rule-based fallback.
 * No network data fetch — bundle must exist on disk. Requires explicit --date.
 *
 * Optional:
 *   --data-root=data
 *   --out=path/to/study-memo.json
 *   --dry-run
 *   --force-fallback   (skip OpenAI even when key is present)
 */

import { mainStudyMemoCli } from "../src/study-agent/cli";

mainStudyMemoCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
