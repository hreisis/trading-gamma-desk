import { readFileSync } from "node:fs";
import {
  ALL_SYMBOLS,
  type RegimeSignatureConfig,
} from "@/contracts";
import { classifyDriver, type ScoreInput } from "@/macro";

interface ScenarioFile {
  scenarios: {
    id: string;
    expect: { primaryRegime: string };
    z: Record<string, number | null>;
  }[];
}

/**
 * Re-run hand scenarios against the live signature config. These are semantic
 * constraints — they must keep classifying to the intended bucket. They are
 * not used to fit numeric thresholds in this report phase.
 */
export function evaluateScenarioConstraints(
  config: RegimeSignatureConfig,
  fixturePath = "fixtures/macro/scenarios.m1.json",
): {
  note: string;
  fixturePath: string;
  results: {
    id: string;
    expectedRegime: string;
    observedRegime: string;
    ok: boolean;
  }[];
} {
  const file = JSON.parse(readFileSync(fixturePath, "utf8")) as ScenarioFile;
  const results = file.scenarios.map((scenario) => {
    const inputs: ScoreInput[] = ALL_SYMBOLS.map((symbol) => ({
      symbol,
      zScore: Object.prototype.hasOwnProperty.call(scenario.z, symbol)
        ? (scenario.z[symbol] as number | null)
        : null,
    }));
    const observed = classifyDriver(inputs, config).primaryRegime;
    return {
      id: scenario.id,
      expectedRegime: scenario.expect.primaryRegime,
      observedRegime: observed,
      ok: observed === scenario.expect.primaryRegime,
    };
  });

  return {
    note: "Scenario fixtures constrain regime semantics. This report does not retune parameters to maximize their pass rate.",
    fixturePath,
    results,
  };
}
