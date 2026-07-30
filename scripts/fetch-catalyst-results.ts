/**
 * Local official BLS release results ingest (actuals only).
 *
 *   npm run catalyst:results:fetch
 *
 * Pulls BLS Public Data API v1 series for CPI + Employment Situation,
 * builds MoM/YoY / payroll change / unemployment level observations, and
 * atomically writes data/catalyst/results-latest.json (gitignored).
 *
 * Does not modify the calendar cache. Consensus/surprise stay unavailable.
 * Disabled under public demo.
 */

import {
  fetchOfficialResults,
  DEFAULT_RESULTS_DATA_ROOT,
} from "../src/catalyst/results/fetch-results";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing official results fetch.",
    );
    process.exit(1);
  }

  const result = await fetchOfficialResults({
    dataRoot: DEFAULT_RESULTS_DATA_ROOT,
    write: true,
  });
  const { cache, path } = result;

  for (const src of cache.sources) {
    if (src.status === "ok") {
      console.log(`[ok] ${src.id} series=${src.seriesCount ?? "?"} ${src.url}`);
    } else {
      console.log(`[error] ${src.id}: ${src.error ?? "unknown"}`);
    }
  }

  console.log(`fetchedAt:  ${cache.fetchedAt}`);
  console.log(`releases:   ${cache.releases.length}`);
  console.log(`revisions:  ${cache.revisions.length}`);
  console.log(`validation: ${cache.validationErrors.length}`);
  console.log(`link warn:  ${cache.linkingWarnings.length}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log("wrote:      (skipped — fetch failed; prior cache left untouched)");
    process.exitCode = 1;
  }

  for (const r of cache.releases.slice(0, 6)) {
    const metrics = r.observations
      .map((o) => `${o.metric}=${o.actual}`)
      .join(", ");
    console.log(
      `  - ${r.releaseFamily} ${r.referencePeriod}: ${metrics}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
