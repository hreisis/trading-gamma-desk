/**
 * Bounded MarketData.app → Gamma Engine provider (credit-capped CLI).
 *
 *   npm run gamma:fetch -- \
 *     --symbol SPY \
 *     --expiration 2026-07-31 \
 *     --strike-min 700 \
 *     --strike-max 780 \
 *     --strike-step 1
 *
 * Optional:
 *   --max-expected-contracts=250   (default safety cap)
 *   --allow-above-cap              (required to exceed cap)
 *   --data-root=/path
 *
 * Auth: MARKETDATA_API_TOKEN (or MARKETDATA_APP_TOKEN). Never logged.
 * Writes data/gamma/providers/marketdata-app/{SYMBOL}-bounded-latest.json
 * only on success. Does not save the raw vendor response.
 * Disabled under public demo. Not part of npm run daily.
 */

import { parseGammaFetchArgs } from "../src/gamma/marketdata-app/args";
import { resolveMarketDataApiToken } from "../src/gamma/marketdata-app/config";
import { runBoundedGammaProvider } from "../src/gamma/marketdata-app/run";

async function main(): Promise<void> {
  if ((process.env.GAMMADESK_PUBLIC_DEMO ?? "").trim()) {
    console.error(
      "GAMMADESK_PUBLIC_DEMO is set — refusing MarketData.app gamma fetch.",
    );
    process.exit(1);
  }

  let args;
  try {
    args = parseGammaFetchArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
    return;
  }

  const hasToken = Boolean(resolveMarketDataApiToken());
  console.log(`symbol:              ${args.symbol}`);
  console.log(`expiration:          ${args.expiration}`);
  console.log(
    `strikes:             ${args.strikeMin}..${args.strikeMax} step ${args.strikeStep}`,
  );
  console.log(`maxExpectedContracts:${args.maxExpectedContracts}`);
  console.log(`allowAboveCap:       ${args.allowAboveCap}`);
  console.log(`token:               ${hasToken ? "present" : "missing"}`);

  const result = await runBoundedGammaProvider({
    symbol: args.symbol,
    expiration: args.expiration,
    strikeMin: args.strikeMin,
    strikeMax: args.strikeMax,
    strikeStep: args.strikeStep,
    maxExpectedContracts: args.maxExpectedContracts,
    allowAboveCap: args.allowAboveCap,
    dataRoot: args.dataRoot,
    write: true,
  });

  if (!result.ok) {
    console.error(`failed: ${result.code} — ${result.error}`);
    console.error(
      "wrote: (skipped — prior bounded snapshot preserved if present)",
    );
    process.exitCode = 1;
    return;
  }

  const s = result.snapshot;
  console.log(`httpStatus:          ${s.httpStatus}`);
  console.log(
    `credits:             consumed=${s.credits.consumed ?? "n/a"} remaining=${s.credits.remaining ?? "n/a"}`,
  );
  console.log(`vendorAsOf:          ${s.vendorAsOf}`);
  console.log(`sessionDate:         ${s.sessionDate}`);
  console.log(`dte:                 ${s.dte}`);
  console.log(`status:              ${s.status}`);
  console.log(`gammaRegime:         ${s.gammaRegime}`);
  console.log(`spot:                ${s.spot}`);
  console.log(
    `coverage:            in=${s.coverage.contractsIn} used=${s.coverage.contractsUsed} skipped=${s.coverage.contractsSkipped}`,
  );
  console.log(
    `gammaQuality:        nonNull=${s.coverage.nonNullGammaCount ?? "n/a"} usable=${s.coverage.usableGammaCount ?? "n/a"} suspect=${s.coverage.suspectVendorGreeksCount ?? "n/a"}`,
  );
  console.log(
    `boundedCallWall:     ${s.boundedCallWall.status} ${s.boundedCallWall.strike ?? ""}`,
  );
  console.log(
    `boundedPutWall:      ${s.boundedPutWall.status} ${s.boundedPutWall.strike ?? ""}`,
  );
  console.log(`scope:               ${s.scope}`);
  console.log(`requestPath:         ${result.requestPath}`);
  if (result.path) {
    console.log(`wrote:               ${result.path}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
