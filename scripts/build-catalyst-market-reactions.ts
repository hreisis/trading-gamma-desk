/**
 * Local market-reactions build (M2-4B).
 *
 *   npm run catalyst:market-reactions:build
 *   npm run catalyst:market-reactions:build -- --force
 *
 * Reads data/catalyst/market-context-latest.json only (no network).
 * Writes data/catalyst/market-reactions-latest.json atomically.
 *
 * Disabled under public demo.
 */

import { buildMarketReactions } from "../src/catalyst/market-reactions/build-reactions";
import { DEFAULT_MARKET_REACTIONS_DATA_ROOT } from "../src/catalyst/market-reactions/paths";
import { REACTION_RULES_VERSION } from "../src/catalyst/market-reactions/version";

function main(): void {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing market-reactions build.",
    );
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  console.log(`rules:      ${REACTION_RULES_VERSION}`);
  console.log(`force:      ${force}`);

  try {
    const { cache, path } = buildMarketReactions({
      dataRoot: DEFAULT_MARKET_REACTIONS_DATA_ROOT,
      write: true,
      force,
    });

    console.log(`status:     ${cache.buildStatus}`);
    console.log(`reactions:  ${cache.reactions.length}`);
    console.log(`errors:     ${cache.errors.length}`);
    console.log(`warnings:   ${cache.warnings.length}`);
    if (path) {
      console.log(`wrote:      ${path}`);
    } else {
      console.log("wrote:      (skipped — prior cache preserved)");
      if (cache.buildStatus === "failed") process.exitCode = 1;
    }
    for (const r of cache.reactions.slice(0, 8)) {
      console.log(
        `  - [${r.status}] ${r.catalystId.slice(0, 18)}… windows=${r.windows.length} obs=${r.observations.length}`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main();
