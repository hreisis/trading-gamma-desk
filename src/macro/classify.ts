import {
  ALL_SYMBOLS,
  CORE_RATE_SYMBOLS,
  CORE_SYMBOLS,
  MacroSymbol,
  Polarity,
  PrimaryRegime,
  RiskDirection,
  type Confidence,
  type HardCapApplied,
  type RegimeSignatureConfig,
} from "@/contracts";
import {
  BELOW_HIGH_CAP,
  BreadthBreakdown,
  AssetContribution,
  buildConfidence,
  computeBreadth,
  contribute,
  thinBreadthCap,
  topConcentration,
} from "./confidence";
import { cosine } from "./math";
import {
  ScoreInput,
  observedZ,
  pickWinner,
  scoreAllRegimes,
} from "./scoring";

/** |risk cosine| below this is reported as mixed. Uncalibrated placeholder. */
export const RISK_MIXED_FLOOR = 0.1;

export { HIGH_BAND_FLOOR, BELOW_HIGH_CAP } from "./confidence";

export interface Classification {
  readonly primaryRegime: PrimaryRegime;
  readonly polarity: Polarity | null;
  readonly riskDirection: RiskDirection | null;
  readonly label: string;
  readonly confidence: Confidence;
  readonly contributions: readonly AssetContribution[];
  readonly breadth: BreadthBreakdown;
  /** Absolute cosine of z against the config's risk vector, or null. */
  readonly riskScore: number | null;
}

function staleSet(inputs: readonly ScoreInput[]): Set<MacroSymbol> {
  return new Set(
    inputs.filter((i) => i.stale === true).map((i) => i.symbol),
  );
}

function isInsufficientData(zBySymbol: ReadonlyMap<MacroSymbol, number>): {
  insufficient: boolean;
  basis: string;
} {
  const missingRates = CORE_RATE_SYMBOLS.filter((s) => !zBySymbol.has(s));
  const present = CORE_SYMBOLS.filter((s) => zBySymbol.has(s)).length;

  if (missingRates.length > 0) {
    return {
      insufficient: true,
      basis: `core rate missing: ${missingRates.join(", ")}`,
    };
  }
  if (present < 6) {
    return {
      insufficient: true,
      basis: `core coverage ${present}/8 < 6`,
    };
  }
  return { insufficient: false, basis: "" };
}

function riskDirectionOf(
  config: RegimeSignatureConfig,
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
): { direction: RiskDirection; score: number | null } {
  const symbols = ALL_SYMBOLS.filter((s) => zBySymbol.has(s));
  const w = symbols.map((s) => config.riskVector[s] ?? 0);
  const z = symbols.map((s) => zBySymbol.get(s)!);
  const score = cosine(w, z);
  if (score === null) return { direction: "mixed", score: null };
  if (Math.abs(score) < RISK_MIXED_FLOOR) {
    return { direction: "mixed", score };
  }
  return { direction: score > 0 ? "risk_on" : "risk_off", score };
}

function polarityOf(score: number): Polarity | null {
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return null;
}

function labelFor(
  regime: PrimaryRegime,
  polarity: Polarity | null,
  risk: RiskDirection | null,
): string {
  if (regime === "insufficient_data") return "Insufficient data";
  if (regime === "mixed_unresolved") return "Mixed / unresolved";
  if (regime === "single_asset_shock") return "Single-asset shock";

  if (regime === "risk_sentiment") {
    if (polarity === "positive") return "Risk-on (broad)";
    if (polarity === "negative") return "Risk-off (broad)";
    return "Risk sentiment unresolved";
  }

  const driver: Record<string, string> = {
    fed_rates: "Rates",
    inflation: "Inflation",
    growth: "Growth",
    liquidity: "Liquidity",
  };
  const head = driver[regime] ?? regime;
  if (risk === "risk_on" || risk === "risk_off") {
    return `${head}-led ${risk.replace("_", "-")}`;
  }
  return `${head}-led (risk mixed)`;
}

function emptyContributions(): AssetContribution[] {
  return ALL_SYMBOLS.map((symbol) => ({
    symbol,
    weight: 0,
    zScore: null,
    rawContribution: 0,
    contribution: 0,
    role: "missing" as const,
  }));
}

/**
 * Deterministic regime classification and confidence from a z-vector.
 *
 * Hard-rule priority (first match wins the regime label):
 *   1. insufficient_data
 *   2. single_asset_shock
 *   3. mixed_unresolved
 * Soft score cap (does not change the regime):
 *   4. effectiveConfirmations < 2 → score capped below the high band
 */
export function classifyDriver(
  inputs: readonly ScoreInput[],
  config: RegimeSignatureConfig,
): Classification {
  const zBySymbol = observedZ(inputs);
  const staleSymbols = staleSet(inputs);

  // --- Hard rule 4 --------------------------------------------------------
  const coverage = isInsufficientData(zBySymbol);
  if (coverage.insufficient) {
    const hardCaps: HardCapApplied[] = [
      {
        rule: "insufficient_data",
        cappedAt: 0,
        basis: coverage.basis,
      },
    ];
    const contributions = emptyContributions().map((c) => {
      const z = zBySymbol.get(c.symbol);
      return {
        ...c,
        zScore: z ?? null,
        role: z === undefined ? ("missing" as const) : ("neutral" as const),
      };
    });
    const breadth: BreadthBreakdown = {
      effectiveConfirmations: 0,
      effectiveBreadth: 0,
      blocksScored: 0,
      exposureTotal: 0,
    };
    // No winning regime to score against; emit a zero-confidence shell.
    const confidence = buildConfidence(
      {
        config,
        winnerRegime: "fed_rates",
        winnerScore: 0,
        runnerUpRegime: null,
        runnerUpScore: null,
        zBySymbol,
        staleSymbols,
      },
      contributions,
      breadth,
      { hardCaps },
    );
    // buildConfidence may produce a non-zero gate from strength alone; the
    // hard cap at 0 is what enforces the contract for this fallback.
    return {
      primaryRegime: "insufficient_data",
      polarity: null,
      riskDirection: null,
      label: labelFor("insufficient_data", null, null),
      confidence,
      contributions,
      breadth,
      riskScore: null,
    };
  }

  const scores = scoreAllRegimes(config, zBySymbol);
  const { winner, runnerUp } = pickWinner(scores);

  if (winner === null || winner.score === null) {
    // Degenerate z (all zeros) — nothing to claim.
    const hardCaps: HardCapApplied[] = [
      {
        rule: "insufficient_data",
        cappedAt: 0,
        basis: "no regime produced a defined cosine (degenerate z)",
      },
    ];
    const contributions = emptyContributions();
    const breadth: BreadthBreakdown = {
      effectiveConfirmations: 0,
      effectiveBreadth: 0,
      blocksScored: 0,
      exposureTotal: 0,
    };
    return {
      primaryRegime: "insufficient_data",
      polarity: null,
      riskDirection: null,
      label: labelFor("insufficient_data", null, null),
      confidence: buildConfidence(
        {
          config,
          winnerRegime: "fed_rates",
          winnerScore: 0,
          runnerUpRegime: null,
          runnerUpScore: null,
          zBySymbol,
          staleSymbols,
        },
        contributions,
        breadth,
        { hardCaps },
      ),
      contributions,
      breadth,
      riskScore: null,
    };
  }

  const contributions = contribute(
    config,
    winner.regime,
    winner.score,
    zBySymbol,
  );
  const breadth = computeBreadth(config, winner.regime, contributions);
  const concentration = topConcentration(contributions);
  const { direction: riskDirection, score: riskScore } = riskDirectionOf(
    config,
    zBySymbol,
  );
  const polarity = polarityOf(winner.score);

  // Distinctiveness is needed both as a component and as the ambiguity gate.
  const hardCaps: HardCapApplied[] = [];

  // --- Hard rule 1 (score only) ------------------------------------------
  if (breadth.effectiveConfirmations < 2) {
    hardCaps.push(thinBreadthCap(breadth.effectiveConfirmations));
  }

  let primaryRegime: PrimaryRegime = winner.regime;
  let outPolarity: Polarity | null = polarity;
  let outRisk: RiskDirection | null = riskDirection;

  // --- Hard rule 2 --------------------------------------------------------
  if (
    breadth.effectiveConfirmations < 2 &&
    concentration > config.confidenceParams.concentrationThreshold
  ) {
    primaryRegime = "single_asset_shock";
    outPolarity = null;
    outRisk = null;
    hardCaps.push({
      rule: "single_asset_shock",
      cappedAt: BELOW_HIGH_CAP,
      basis: `topConcentration=${concentration.toFixed(3)} > ${config.confidenceParams.concentrationThreshold} with effectiveConfirmations=${breadth.effectiveConfirmations.toFixed(3)} < 2`,
    });
  } else {
    // --- Hard rule 3 ------------------------------------------------------
    // Evaluate distinctiveness the same way confidence will, so the gate and
    // the component cannot disagree.
    const confidenceProbe = buildConfidence(
      {
        config,
        winnerRegime: winner.regime,
        winnerScore: winner.score,
        runnerUpRegime: runnerUp?.regime ?? null,
        runnerUpScore: runnerUp?.score ?? null,
        zBySymbol,
        staleSymbols,
      },
      contributions,
      breadth,
      { hardCaps: [] },
    );
    const distinctiveness = confidenceProbe.components.find(
      (c) => c.name === "distinctiveness",
    )!.value;

    if (distinctiveness < config.confidenceParams.ambiguityFloor) {
      primaryRegime = "mixed_unresolved";
      outPolarity = null;
      outRisk = null;
      hardCaps.push({
        rule: "mixed_unresolved",
        cappedAt: BELOW_HIGH_CAP,
        basis: `distinctiveness=${distinctiveness.toFixed(3)} < ambiguityFloor=${config.confidenceParams.ambiguityFloor}`,
      });
    }
  }

  const confidence = buildConfidence(
    {
      config,
      winnerRegime: winner.regime,
      winnerScore: winner.score,
      runnerUpRegime: runnerUp?.regime ?? null,
      runnerUpScore: runnerUp?.score ?? null,
      zBySymbol,
      staleSymbols,
    },
    contributions,
    breadth,
    { hardCaps },
  );

  return {
    primaryRegime,
    polarity: outPolarity,
    riskDirection: outRisk,
    label: labelFor(primaryRegime, outPolarity, outRisk),
    confidence,
    contributions,
    breadth,
    riskScore,
  };
}
