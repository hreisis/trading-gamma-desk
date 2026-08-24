/**
 * Import GEXTool SPY/QQQ history CSVs into ManualGammaSnapshot files.
 *
 *   npm run import:gextool-history
 *   npm run import:gextool-history -- --force
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { importGexToolHistoryFiles } from "@/desk/import-gextool-history";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = hasFlag(argv, "--force");
  const dataRoot = join(process.cwd(), "data");
  const spyCsvPath = join(dataRoot, "import/gextool/SPY_gex_history.csv");
  const qqqCsvPath = join(dataRoot, "import/gextool/QQQ_gex_history.csv");

  for (const path of [spyCsvPath, qqqCsvPath]) {
    if (!existsSync(path)) {
      console.error(`missing CSV: ${path}`);
      process.exitCode = 1;
      return;
    }
  }

  const result = await importGexToolHistoryFiles({
    spyCsvPath,
    qqqCsvPath,
    store: resolveRuntimeJsonStore(process.env),
    force,
  });

  console.log(`generated: ${result.generated.length}`);
  for (const date of result.generated) {
    console.log(`  ${date}`);
  }
  console.log(`skipped: ${result.skipped.length}`);
  for (const row of result.skipped) {
    console.log(`  ${row.sessionDate} · ${row.reason}`);
  }
  console.log(`removed non-session snapshots: ${result.removed.length}`);
  for (const date of result.removed) {
    console.log(`  ${date}`);
  }
  const sample = result.snapshots[0] ?? null;
  if (sample) {
    console.log("sample:");
    console.log(JSON.stringify(sample, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
