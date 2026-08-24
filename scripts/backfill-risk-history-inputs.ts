/**
 * Backfill same-session Breadth + Macro artifacts for Risk V1 replay.
 *
 *   npm run backfill:risk-history-inputs
 */
import { join } from "node:path";
import { backfillRiskHistoryInputs } from "@/desk/backfill-risk-history-inputs";

async function main(): Promise<void> {
  const result = await backfillRiskHistoryInputs({
    dataRoot: join(process.cwd(), "data"),
  });

  console.log("Breadth newly written:");
  console.log(
    result.breadthWritten.length === 0
      ? "  (none)"
      : result.breadthWritten.map((date) => `  ${date}`).join("\n"),
  );
  console.log("Breadth already present:");
  console.log(
    result.breadthAlreadyPresent.length === 0
      ? "  (none)"
      : result.breadthAlreadyPresent.map((date) => `  ${date}`).join("\n"),
  );
  console.log("Breadth skipped:");
  console.log(
    result.breadthSkipped.length === 0
      ? "  (none)"
      : result.breadthSkipped
          .map((row) => `  ${row.sessionDate} · ${row.reason}`)
          .join("\n"),
  );
  console.log("Macro written:");
  console.log(
    result.macroWritten.length === 0
      ? "  (none)"
      : result.macroWritten.map((date) => `  ${date}`).join("\n"),
  );
  console.log("Macro skipped:");
  console.log(
    result.macroSkipped.length === 0
      ? "  (none)"
      : result.macroSkipped
          .map((row) => `  ${row.sessionDate} · ${row.reason}`)
          .join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
