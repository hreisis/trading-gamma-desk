/**
 * Local official release document ingest (M2-3A).
 *
 *   npm run catalyst:documents:fetch
 *
 * Pulls Federal Reserve monetary-policy press RSS, BLS CPI + Employment
 * Situation RSS, and BEA news RSS (GDP / Personal Income / Trade filter).
 * Atomically writes data/catalyst/documents-latest.json (gitignored).
 *
 * Does not modify calendar or results caches. No LLM summarization.
 * Disabled under public demo.
 */

import {
  fetchOfficialDocuments,
  DEFAULT_DOCUMENTS_DATA_ROOT,
} from "../src/catalyst/documents/fetch-documents";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing official documents fetch.",
    );
    process.exit(1);
  }

  const result = await fetchOfficialDocuments({
    dataRoot: DEFAULT_DOCUMENTS_DATA_ROOT,
    write: true,
  });
  const { cache, path } = result;

  for (const src of cache.sources) {
    if (src.status === "ok") {
      console.log(
        `[ok] ${src.id} docs=${src.mappedDocumentCount ?? "?"} ${src.url}`,
      );
      if (src.error) console.log(`      note: ${src.error}`);
    } else {
      console.log(`[error] ${src.id}: ${src.error ?? "unknown"}`);
    }
  }

  console.log(`fetchedAt:  ${cache.fetchedAt}`);
  console.log(`archive:    ${cache.documents.length}`);
  console.log(`revisions:  ${cache.revisions.length}`);
  console.log(`validation: ${cache.validationErrors.length}`);
  console.log(`link warn:  ${cache.linkingWarnings.length}`);
  console.log(`partial:    ${cache.partialFailure}`);

  if (path) {
    console.log(`wrote:      ${path}`);
  } else {
    console.log(
      "wrote:      (skipped — all providers failed; prior cache left untouched)",
    );
    process.exitCode = 1;
  }

  for (const d of cache.documents.slice(0, 8)) {
    console.log(
      `  - ${d.documentType} ${d.referencePeriod ?? "—"} ${d.publishedAt.slice(0, 10)} ${d.title}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
