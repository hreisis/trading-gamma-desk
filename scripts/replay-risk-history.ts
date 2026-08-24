/**
 * Replay Risk Decision V1 on same-session historical artifacts.
 *
 *   npm run replay:risk-history
 */
import { join } from "node:path";
import {
  RISK_HISTORY_PRIORITY_DATES,
  formatRiskHistoryReplayTable,
  replayRiskHistory,
  riskHistoryReplayToCsv,
} from "@/desk/replay-risk-history";

async function main(): Promise<void> {
  const dataRoot = join(process.cwd(), "data");
  const rows = await replayRiskHistory({ dataRoot });
  const priority = new Set<string>(RISK_HISTORY_PRIORITY_DATES);
  const priorityRows = rows.filter((row) => priority.has(row.date));
  const otherRows = rows.filter((row) => !priority.has(row.date));

  console.log("Risk V1 historical replay (same-session inputs only)");
  console.log("Model weight 90; withheld when effective coverage < 45.");
  console.log("Event gate is reconstructed as-of 16:00 ET that session from local catalyst caches.");
  console.log("");
  console.log("Priority dates");
  console.log(formatRiskHistoryReplayTable(priorityRows));
  if (otherRows.length > 0) {
    console.log("");
    console.log("Other available dates");
    console.log(formatRiskHistoryReplayTable(otherRows));
  }
  console.log("");
  console.log("CSV");
  console.log(riskHistoryReplayToCsv(rows).trimEnd());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
