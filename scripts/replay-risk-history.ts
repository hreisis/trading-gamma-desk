/**
 * Replay Risk Decision V1 on same-session historical artifacts.
 *
 *   npm run replay:risk-history
 */
import { join } from "node:path";
import {
  OPPORTUNITY_V2_REPLAY_DATES,
  formatHygLqdReplayTable,
  formatPositioningReplayTable,
  replayRiskHistory,
} from "@/desk/replay-risk-history";

async function main(): Promise<void> {
  const dataRoot = join(process.cwd(), "data");
  const argvDates = process.argv
    .slice(2)
    .filter((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const dates = argvDates.length > 0 ? argvDates : [...OPPORTUNITY_V2_REPLAY_DATES];
  const rows = await replayRiskHistory({
    dataRoot,
    dates,
  });

  console.log("Positioning V2 (replay only; Risk / Opportunity / Trend unchanged)");
  console.log("");
  console.log(formatPositioningReplayTable(rows));
  console.log("");
  console.log("HYG/LQD credit (Alpaca daily bars; AI Study only — not in Risk score)");
  console.log("");
  console.log(formatHygLqdReplayTable(rows));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
