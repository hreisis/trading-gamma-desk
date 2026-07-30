/**
 * Local evidence-grounded brief build (M2-3B).
 *
 *   npm run catalyst:briefs:build
 *
 * Reads gitignored data/catalyst/documents-latest.json (optional results
 * for cross-check). Never networks. Atomically writes
 * data/catalyst/briefs-latest.json.
 *
 * Disabled under public demo.
 */

import {
  buildOfficialBriefs,
  DEFAULT_BRIEFS_DATA_ROOT,
} from "../src/catalyst/briefs/build-briefs";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing official briefs build.",
    );
    process.exit(1);
  }

  const { cache, path } = buildOfficialBriefs({
    dataRoot: DEFAULT_BRIEFS_DATA_ROOT,
    write: true,
  });

  console.log(`extractor:  ${cache.extractorVersion}`);
  console.log(`generated:  ${cache.generatedAt}`);
  console.log(`status:     ${cache.buildStatus}`);
  console.log(`briefs:     ${cache.briefs.length}`);
  console.log(`revisions:  ${cache.revisions.length}`);
  console.log(`warnings:   ${cache.warnings.length}`);
  console.log(`errors:     ${cache.errors.length}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log("wrote:      (skipped — build failed; prior cache untouched)");
    process.exitCode = 1;
  }

  for (const b of cache.briefs.slice(0, 10)) {
    console.log(
      `  - [${b.status}] ${b.releaseFamily} ${b.referencePeriod ?? "—"} facts=${b.facts.length} :: ${b.headline}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
