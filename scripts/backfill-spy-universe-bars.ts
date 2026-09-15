/**
 * Backfill SPY constituent 1Day bars into data/bars/spy-universe.
 *
 *   npm run backfill:spy-universe-bars
 */
import { join } from "node:path";
import { backfillSpyUniverseDailyBars } from "@/desk/backfill-spy-universe-bars";

async function main(): Promise<void> {
  const result = await backfillSpyUniverseDailyBars({
    dataRoot: join(process.cwd(), "data"),
  });

  console.log(
    `range ${result.startDate} → ${result.endDate} (${result.expectedSessions} sessions)`,
  );
  console.log(
    `holdings asOf ${result.holdingsAsOf ?? "unknown"} · ${result.symbolCount} symbols`,
  );
  console.log(`already complete: ${result.alreadyComplete}`);
  console.log(`fetched: ${result.symbolsFetched}`);
  console.log(
    `API requests: ${result.apiRequests} · batches: ${result.batches}`,
  );
  console.log(`symbols filled: ${result.symbolsFilled.length}`);
  if (result.symbolsFilled.length > 0 && result.symbolsFilled.length <= 40) {
    console.log(`  ${result.symbolsFilled.join(", ")}`);
  }
  console.log(`remaining missing: ${result.remainingMissing.length}`);
  for (const row of result.remainingMissing.slice(0, 40)) {
    console.log(`  ${row.symbol} · ${row.missingSessions} session(s)`);
  }
  if (result.remainingMissing.length > 40) {
    console.log(`  … ${result.remainingMissing.length - 40} more`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
