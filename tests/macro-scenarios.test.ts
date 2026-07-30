import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SYMBOLS,
  Confidence,
  RegimeSignatureConfig,
  type MacroSymbol,
} from "@/contracts";
import { classifyDriver, type ScoreInput } from "@/macro";

interface ScenarioExpect {
  primaryRegime: string;
  polarity: string | null;
  riskDirection: string | null;
  confidenceScore?: number;
}

interface Scenario {
  id: string;
  description: string;
  expect: ScenarioExpect;
  z: Record<string, number | null>;
}

interface ScenarioFile {
  signatureVersion: string;
  scenarios: Scenario[];
}

const config = RegimeSignatureConfig.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/macro/regime-signature.sig-2026-07-01.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const file = JSON.parse(
  readFileSync(
    new URL("../fixtures/macro/scenarios.m1.json", import.meta.url),
    "utf8",
  ),
) as ScenarioFile;

function toInputs(z: Record<string, number | null>): ScoreInput[] {
  return ALL_SYMBOLS.map((symbol) => ({
    symbol,
    zScore: Object.prototype.hasOwnProperty.call(z, symbol)
      ? z[symbol]!
      : null,
  }));
}

describe("M1-6 scenario fixtures", () => {
  it("targets the signature version under test", () => {
    expect(file.signatureVersion).toBe(config.signatureVersion);
  });

  it("covers every required scenario id", () => {
    const ids = new Set(file.scenarios.map((s) => s.id));
    for (const required of [
      "fed_rates_easing",
      "inflation",
      "growth",
      "risk_off",
      "mixed_unresolved",
      "single_asset_shock",
      "insufficient_data_missing_rate",
      "insufficient_data_sparse_coverage",
    ]) {
      expect(ids.has(required), `missing scenario ${required}`).toBe(true);
    }
  });

  for (const scenario of file.scenarios) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      const result = classifyDriver(toInputs(scenario.z), config);

      expect(result.primaryRegime).toBe(scenario.expect.primaryRegime);
      expect(result.polarity).toBe(scenario.expect.polarity);
      expect(result.riskDirection).toBe(scenario.expect.riskDirection);

      if (scenario.expect.confidenceScore !== undefined) {
        expect(result.confidence.score).toBe(scenario.expect.confidenceScore);
      }

      const parsed = Confidence.safeParse(result.confidence);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

      // Fallback regimes must not smuggle a directional claim.
      if (
        scenario.expect.primaryRegime === "mixed_unresolved" ||
        scenario.expect.primaryRegime === "single_asset_shock" ||
        scenario.expect.primaryRegime === "insufficient_data"
      ) {
        expect(result.polarity).toBeNull();
        expect(result.riskDirection).toBeNull();
      }

      if (scenario.expect.primaryRegime === "risk_sentiment") {
        expect(result.label).toMatch(/^Risk-(on|off) \(broad\)$/);
      }

      // Every symbol in the fixture is a registry member.
      for (const symbol of Object.keys(scenario.z)) {
        expect(ALL_SYMBOLS.includes(symbol as MacroSymbol)).toBe(true);
      }
    });
  }
});
