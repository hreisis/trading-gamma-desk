/**
 * Local official US macro calendar ingest (schedule times only).
 *
 *   npm run catalyst:fetch
 *
 * Pulls BLS ICS + BEA release_dates.json, normalizes through the shared
 * Catalyst pipeline, and atomically writes data/catalyst/calendar-latest.json
 * (gitignored). No actual/forecast/surprise. Disabled under public demo.
 */

import {
  fetchOfficialCalendar,
  DEFAULT_CATALYST_DATA_ROOT,
} from "../src/catalyst/fetch-calendar";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing official calendar fetch.",
    );
    process.exit(1);
  }

  const result = await fetchOfficialCalendar({
    dataRoot: DEFAULT_CATALYST_DATA_ROOT,
    write: true,
  });
  const { cache, path } = result;

  for (const src of cache.sources) {
    const count =
      src.mappedEventCount !== undefined
        ? ` mapped=${src.mappedEventCount}`
        : "";
    if (src.status === "ok") {
      console.log(`[ok] ${src.id}${count} ${src.url ?? ""}`);
    } else {
      console.log(`[error] ${src.id}: ${src.error ?? "unknown"}`);
    }
  }

  console.log(`window:     ${cache.requestedWindow.start} → ${cache.requestedWindow.end}`);
  console.log(`fetchedAt:  ${cache.fetchedAt}`);
  console.log(`catalysts:  ${cache.catalysts.length}`);
  console.log(`partial:    ${cache.partialFailure}`);
  console.log(`validation: ${cache.validationErrors.length} error(s)`);
  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log(
      "wrote:      (skipped — both providers failed; prior cache left untouched)",
    );
    process.exitCode = 1;
  }

  // Sample upcoming headlines for manual verification.
  const samples = cache.catalysts.slice(0, 8);
  if (samples.length > 0) {
    console.log("sample:");
    for (const c of samples) {
      console.log(`  - ${c.occurredAt}  ${c.headline}  [${c.sourceName}]`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
