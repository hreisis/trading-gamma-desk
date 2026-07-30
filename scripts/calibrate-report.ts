/**
 * Point-in-time calibration report (M1-6b report-only phase).
 *
 *   npm run calibrate
 *
 * Reads gitignored data/bars, replays the macro pipeline day by day with no
 * look-ahead, writes:
 *   - fixtures/macro/calibration/report-<lastSession>.json  (aggregates, commit-safe)
 *   - data/calibration/days-<lastSession>.json              (per-day ledger, gitignored)
 *
 * Does not modify confidenceParams and does not set calibrated: true.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ALL_SYMBOLS,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "../src/contracts";
import {
  HIGH_BAND_FLOOR,
  DEFAULT_WINDOW_LENGTH,
} from "../src/macro";
import type { SymbolSeries } from "../src/ingest";
import {
  aggregateRecords,
  buildParameterSuggestions,
  evaluateScenarioConstraints,
  replayHistory,
} from "../src/calibrate";

const MIN_HISTORY = DEFAULT_WINDOW_LENGTH + 2;

function loadLocalBars(root: string): SymbolSeries[] {
  return ALL_SYMBOLS.map((symbol) => {
    const path = join(root, "bars", `${symbol}.json`);
    if (!existsSync(path)) {
      throw new Error(
        `missing ${path}; run npm run ingest first (Tiingo series stay local)`,
      );
    }
    return JSON.parse(readFileSync(path, "utf8")) as SymbolSeries;
  });
}

function main(): void {
  const config = RegimeSignatureConfig.parse(
    JSON.parse(
      readFileSync(
        "fixtures/macro/regime-signature.sig-2026-07-01.json",
        "utf8",
      ),
    ),
  );

  const series = loadLocalBars("data");
  const records = replayHistory(series, config, {
    minHistorySessions: MIN_HISTORY,
  });

  if (records.length === 0) {
    throw new Error("replay produced zero days; need a longer local bar cache");
  }

  const scenarioConstraints = evaluateScenarioConstraints(config);
  const suggestions = buildParameterSuggestions(records, {
    marginRef: config.confidenceParams.marginRef,
    ambiguityFloor: config.confidenceParams.ambiguityFloor,
    concentrationThreshold: config.confidenceParams.concentrationThreshold,
    highBandFloor: HIGH_BAND_FLOOR,
  });

  const report = aggregateRecords(records, {
    minHistorySessions: MIN_HISTORY,
    scenarioConstraints,
    parameterSuggestions: suggestions,
  });

  const last = report.sample.lastSession!;
  mkdirSync("fixtures/macro/calibration", { recursive: true });
  const reportPath = join(
    "fixtures/macro/calibration",
    `report-${last}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  mkdirSync("data/calibration", { recursive: true });
  const daysPath = join("data/calibration", `days-${last}.json`);
  writeFileSync(
    daysPath,
    JSON.stringify(
      {
        note: "Per-day PIT ledger. Local only — not for commit. Contains no raw prices.",
        generatedAt: report.generatedAt,
        days: records,
      },
      null,
      2,
    ) + "\n",
  );

  const failedScenarios = scenarioConstraints.results.filter((r) => !r.ok);
  console.log(`days:              ${report.sample.dayCount}`);
  console.log(
    `range:             ${report.sample.firstSession} -> ${report.sample.lastSession}`,
  );
  console.log(
    `regimes:           ${JSON.stringify(report.regimeFrequency)}`,
  );
  console.log(
    `fallbacks:         ${JSON.stringify(report.fallbackFrequency)}`,
  );
  console.log(
    `confidence p50:    ${report.distributions.confidenceScore.p50}`,
  );
  console.log(
    `winnerMargin p50:  ${report.distributions.winnerMargin.p50}`,
  );
  console.log(
    `scenarios:         ${scenarioConstraints.results.length - failedScenarios.length}/${scenarioConstraints.results.length} ok`,
  );
  console.log(`report:            ${reportPath}`);
  console.log(`day ledger (local):${daysPath}`);
  console.log(`calibrated:        remains false (report-only)`);

  if (failedScenarios.length > 0) {
    console.error("scenario constraints failed:", failedScenarios);
    process.exit(1);
  }
}

main();
