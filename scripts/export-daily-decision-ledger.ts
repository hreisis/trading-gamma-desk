/**
 * Export private Daily Decision Ledger rows to CSV.
 * Usage: npx tsx scripts/export-daily-decision-ledger.ts
 */
import { resolveRuntimeDataRoot } from "@/desk/production-runtime";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import { exportDailyDecisionLedgerCsv } from "@/desk/daily-decision-ledger";

async function main(): Promise<void> {
  const env = process.env;
  const dataRoot = resolveRuntimeDataRoot(env);
  const artifactStore = resolveRuntimeJsonStore(env);
  const generatedAt = new Date().toISOString().replace(/[:.]/g, "-");

  const { csv, recordCount } = await exportDailyDecisionLedgerCsv({
    dataRoot,
    artifactStore,
    generatedAt,
  });

  console.log(`Exported ${recordCount} ledger session(s).`);
  console.log(csv);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
