/**
 * Local market-context fetch (M2-4A).
 *
 *   npm run catalyst:market-context:fetch
 *   npm run catalyst:market-context:fetch -- --force
 *   npm run catalyst:market-context:fetch -- --max=2
 *
 * Reads calendar + results caches only (no documents/briefs/AI fetch).
 * Uses Alpaca Historical Stock Bars when credentials are set.
 * Writes data/catalyst/market-context-latest.json atomically.
 *
 * Disabled under public demo. Does not log API secrets.
 */

import { fetchOfficialMarketContext } from "../src/catalyst/market-context/fetch-market-context";
import { DEFAULT_MARKET_CONTEXT_DATA_ROOT } from "../src/catalyst/market-context/paths";
import {
  resolveAlpacaCredentials,
  resolveCatalystMarketFeed,
} from "../src/catalyst/market-context/config";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing market-context fetch.",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const maxPerRun = maxArg
    ? Number(maxArg.slice("--max=".length))
    : undefined;
  const feed = resolveCatalystMarketFeed();
  const hasCreds = Boolean(resolveAlpacaCredentials());

  console.log(`feed:       ${feed}`);
  console.log(`credentials:${hasCreds ? "present" : "missing"}`);
  console.log(`force:      ${force}`);
  if (maxPerRun !== undefined) console.log(`maxPerRun:  ${maxPerRun}`);

  const { cache, path } = await fetchOfficialMarketContext({
    dataRoot: DEFAULT_MARKET_CONTEXT_DATA_ROOT,
    write: true,
    force,
    maxPerRun: Number.isFinite(maxPerRun) ? maxPerRun : undefined,
  });

  console.log(`provider:   ${cache.provider}`);
  console.log(`calc:       ${cache.calculationVersion}`);
  console.log(`status:     ${cache.buildStatus}`);
  console.log(`snapshots:  ${cache.snapshots.length}`);
  console.log(`errors:     ${cache.errors.length}`);
  console.log(`warnings:   ${cache.warnings.length}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log(
      "wrote:      (skipped — unavailable/provider failure; prior cache preserved)",
    );
    if (
      cache.buildStatus === "unavailable" ||
      cache.buildStatus === "failed"
    ) {
      process.exitCode = 1;
    }
  }

  for (const s of cache.snapshots.slice(0, 8)) {
    console.log(
      `  - [${s.status}] ${s.catalystId.slice(0, 18)}… ${s.eventTimestamp} symbols=${s.symbols.length}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
