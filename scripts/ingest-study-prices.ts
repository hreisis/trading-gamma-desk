/**
 * Build exact-date StudyPriceSeries from cached SPY bars.
 *
 *   npm run studies:ingest-prices -- --date YYYY-MM-DD
 *
 * Requires data/bars/SPY.json from `npm run ingest` (Tiingo). Never commits data/.
 */

import { ingestStudyPrices, parseIngestStudyPricesArgs } from "../src/studies/ingest-prices";

function main(): void {
  const { asOfSessionDate, dataRoot } = parseIngestStudyPricesArgs(
    process.argv.slice(2),
  );

  const result = ingestStudyPrices({ asOfSessionDate, dataRoot });
  const { series, artifactPath, barsSourcePath } = result;
  const prov = series.provenance!;

  console.log(`asOfSessionDate:   ${asOfSessionDate}`);
  console.log(`barsSource:        ${barsSourcePath}`);
  console.log(`artifact:          ${artifactPath}`);
  console.log(`symbol:            ${series.symbol}`);
  console.log(`synthetic:         ${series.synthetic}`);
  console.log(`source:            ${series.source}`);
  console.log(`barCount:          ${prov.barCount}`);
  console.log(`firstSessionDate:  ${prov.firstSessionDate}`);
  console.log(`lastSessionDate:   ${prov.lastSessionDate}`);
  console.log(`ingestedAt:        ${prov.ingestedAt}`);
  console.log(
    `sourceArtifactRef: ${prov.sourceArtifactRef.relativePath} (${prov.sourceArtifactRef.vendor})`,
  );
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
