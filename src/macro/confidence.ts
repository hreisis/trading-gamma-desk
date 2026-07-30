import {
  ALL_SYMBOLS,
  CONFIDENCE_COMPONENT_NAMES,
  CORE_SYMBOLS,
  EvidenceBlock,
  MacroSymbol,
  type Confidence,
  type ConfidenceComponentName,
  type HardCapApplied,
  type Regime,
  type RegimeSignatureConfig,
} from "@/contracts";
import { clamp01, cosine, rms, weightedGeometricMean } from "./math";

/**
 * Uncalibrated placeholder: the high band is treated as starting at 70, so a
 * hard gate that must keep the score "below high" caps at 69. M1-6b replaces
 * both numbers from fixtures; until then nothing may render the band label.
 */
export const HIGH_BAND_FLOOR = 70;
export const BELOW_HIGH_CAP = HIGH_BAND_FLOOR - 1;

/**
 * |z| below this is treated as noise for role assignment. Placeholder until
 * M1-6b; chosen so a half-sigma wiggle cannot mint a confirmation.
 */
export const Z_NOISE_FLOOR = 0.5;

export type AssetRoleName =
  | "confirming"
  | "contradicting"
  | "neutral"
  | "missing";

export interface AssetContribution {
  readonly symbol: MacroSymbol;
  readonly weight: number;
  readonly zScore: number | null;
  readonly rawContribution: number;
  /** Share of Σ|w z|, signed. Zero when the asset is absent from the signature. */
  readonly contribution: number;
  readonly role: AssetRoleName;
}

export interface BreadthBreakdown {
  readonly effectiveConfirmations: number;
  readonly effectiveBreadth: number;
  readonly blocksScored: number;
  readonly exposureTotal: number;
}

export interface ConfidenceComponentsInput {
  readonly config: RegimeSignatureConfig;
  readonly winnerRegime: Regime;
  readonly winnerScore: number;
  readonly runnerUpRegime: Regime | null;
  readonly runnerUpScore: number | null;
  readonly zBySymbol: ReadonlyMap<MacroSymbol, number>;
  readonly staleSymbols: ReadonlySet<MacroSymbol>;
}

function weightOf(
  config: RegimeSignatureConfig,
  regime: Regime,
  symbol: MacroSymbol,
): number {
  return config.signatures[regime]?.[symbol] ?? 0;
}

/**
 * Assign roles and contribution shares against the winning signature.
 * Contribution is (w·z) / Σ|w·z| so the vector of shares is auditable and
 * sums in absolute value to 1 when anything moved.
 */
export function contribute(
  config: RegimeSignatureConfig,
  winnerRegime: Regime,
  winnerScore: number,
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
): AssetContribution[] {
  const scoreSign = Math.sign(winnerScore);
  const raw = new Map<MacroSymbol, number>();
  let absSum = 0;

  for (const symbol of ALL_SYMBOLS) {
    const z = zBySymbol.get(symbol);
    const w = weightOf(config, winnerRegime, symbol);
    if (z === undefined || w === 0) {
      raw.set(symbol, 0);
      continue;
    }
    const value = w * z;
    raw.set(symbol, value);
    absSum += Math.abs(value);
  }

  return ALL_SYMBOLS.map((symbol) => {
    const zScore = zBySymbol.has(symbol) ? zBySymbol.get(symbol)! : null;
    const weight = weightOf(config, winnerRegime, symbol);
    const rawContribution = raw.get(symbol) ?? 0;
    const contribution = absSum === 0 ? 0 : rawContribution / absSum;

    let role: AssetRoleName;
    if (zScore === null) {
      role = "missing";
    } else if (weight === 0) {
      role = "neutral";
    } else if (Math.abs(zScore) < Z_NOISE_FLOOR) {
      role = "neutral";
    } else if (scoreSign === 0 || rawContribution === 0) {
      role = "neutral";
    } else if (Math.sign(rawContribution) === scoreSign) {
      role = "confirming";
    } else {
      role = "contradicting";
    }

    return {
      symbol,
      weight,
      zScore,
      rawContribution,
      contribution,
      role,
    };
  });
}

export function computeBreadth(
  config: RegimeSignatureConfig,
  winnerRegime: Regime,
  contributions: readonly AssetContribution[],
): BreadthBreakdown {
  const bySymbol = new Map(contributions.map((c) => [c.symbol, c]));
  let effectiveConfirmations = 0;
  let weightedConfirm = 0;
  let exposureTotal = 0;
  let blocksScored = 0;

  for (const [block, symbols] of Object.entries(config.evidenceBlocks) as [
    EvidenceBlock,
    MacroSymbol[],
  ][]) {
    const members = symbols
      .map((symbol) => bySymbol.get(symbol)!)
      .filter((c) => c.weight !== 0);

    const observed = members.filter((c) => c.zScore !== null);
    if (observed.length === 0) continue;

    // Block carries signature weight and has data — it is scored.
    blocksScored += 1;

    const exposure = Math.min(
      observed.reduce((sum, c) => sum + Math.abs(c.weight), 0),
      config.blockWeightBudget[block] ?? Number.POSITIVE_INFINITY,
    );
    exposureTotal += exposure;

    const confirmingCount = observed.filter((c) => c.role === "confirming").length;
    const confirmRatio = confirmingCount / observed.length;
    effectiveConfirmations += confirmRatio;
    weightedConfirm += exposure * confirmRatio;
  }

  return {
    effectiveConfirmations,
    effectiveBreadth: exposureTotal === 0 ? 0 : weightedConfirm / exposureTotal,
    blocksScored,
    exposureTotal,
  };
}

export function computeCoherence(
  contributions: readonly AssetContribution[],
): number {
  let confirming = 0;
  let contradicting = 0;
  for (const c of contributions) {
    if (c.role === "confirming") confirming += Math.abs(c.rawContribution);
    if (c.role === "contradicting") contradicting += Math.abs(c.rawContribution);
  }
  const denom = confirming + contradicting;
  if (denom === 0) return 0;
  return confirming / denom;
}

export function computeStrength(zBySymbol: ReadonlyMap<MacroSymbol, number>): number {
  return clamp01(rms([...zBySymbol.values()]) / 2);
}

/**
 * Share of the eight core assets that are missing from the observed set or
 * flagged stale. Applied once, outside the geometric mean, so breadth is not
 * charged for the same absence a second time.
 */
export function coveragePenalty(
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
  staleSymbols: ReadonlySet<MacroSymbol>,
): number {
  let bad = 0;
  for (const symbol of CORE_SYMBOLS) {
    if (!zBySymbol.has(symbol) || staleSymbols.has(symbol)) bad += 1;
  }
  return bad / CORE_SYMBOLS.length;
}

export function computeDistinctiveness(
  config: RegimeSignatureConfig,
  winnerRegime: Regime,
  winnerScore: number,
  runnerUpRegime: Regime | null,
  runnerUpScore: number | null,
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
): { distinctiveness: number; templateSimilarity: number | null } {
  if (runnerUpRegime === null || runnerUpScore === null) {
    return { distinctiveness: 1, templateSimilarity: null };
  }

  const observed = ALL_SYMBOLS.filter((s) => zBySymbol.has(s));
  const wTop = observed.map((s) => weightOf(config, winnerRegime, s));
  const wSecond = observed.map((s) => weightOf(config, runnerUpRegime, s));
  const similarity = Math.abs(cosine(wTop, wSecond) ?? 0);
  const effectiveMarginRef =
    config.confidenceParams.marginRef * (1 + similarity);
  const gap = Math.abs(winnerScore) - Math.abs(runnerUpScore);
  return {
    distinctiveness: clamp01(gap / effectiveMarginRef),
    templateSimilarity: similarity,
  };
}

export function topConcentration(
  contributions: readonly AssetContribution[],
): number {
  let absSum = 0;
  let top = 0;
  for (const c of contributions) {
    const magnitude = Math.abs(c.rawContribution);
    absSum += magnitude;
    if (magnitude > top) top = magnitude;
  }
  if (absSum === 0) return 0;
  return top / absSum;
}

export function buildConfidence(
  input: ConfidenceComponentsInput,
  contributions: readonly AssetContribution[],
  breadth: BreadthBreakdown,
  options: { readonly hardCaps: HardCapApplied[] },
): Confidence {
  const { config, winnerRegime, winnerScore, runnerUpRegime, runnerUpScore } =
    input;
  const { distinctiveness, templateSimilarity } = computeDistinctiveness(
    config,
    winnerRegime,
    winnerScore,
    runnerUpRegime,
    runnerUpScore,
    input.zBySymbol,
  );

  const values: Record<ConfidenceComponentName, number> = {
    patternMatch: Math.abs(winnerScore),
    distinctiveness,
    coherence: computeCoherence(contributions),
    effectiveBreadth: breadth.effectiveBreadth,
    strength: computeStrength(input.zBySymbol),
  };

  const components = CONFIDENCE_COMPONENT_NAMES.map((name) => ({
    name,
    value: values[name],
    weight: config.confidenceParams.lambda[name]!,
  }));

  const penalty = coveragePenalty(input.zBySymbol, input.staleSymbols);
  const { gate, zeroedIndex } = weightedGeometricMean(components);
  const zeroedBy =
    zeroedIndex === null ? null : components[zeroedIndex]!.name;

  // A non-positive component vetoes the score outright. Hard caps then bind
  // whatever remains; insufficient_data uses cappedAt: 0 so the score is
  // zero even when every component happens to be positive.
  let score = zeroedBy !== null ? 0 : Math.round(100 * clamp01(gate - penalty));

  const hardCapsApplied = [...options.hardCaps];
  for (const cap of hardCapsApplied) {
    if (score > cap.cappedAt) score = cap.cappedAt;
  }

  return {
    score,
    aggregation: "weighted_geometric_mean",
    components,
    coveragePenalty: penalty,
    zeroedBy,
    hardCapsApplied,
    calibrated: config.confidenceParams.calibrated,
    detail: {
      runnerUpRegime,
      scoreTop: winnerScore,
      scoreSecond: runnerUpScore,
      templateSimilarity,
      effectiveConfirmations: breadth.effectiveConfirmations,
      blocksScored: breadth.blocksScored,
      exposureTotal: breadth.exposureTotal,
    },
  };
}

/** Cap used when confirmations are too thin to support a high score. */
export function thinBreadthCap(effectiveConfirmations: number): HardCapApplied {
  return {
    rule: "insufficient_effective_confirmations",
    cappedAt: BELOW_HIGH_CAP,
    basis: `effectiveConfirmations=${effectiveConfirmations.toFixed(3)} < 2; highBandFloor=${HIGH_BAND_FLOOR} (uncalibrated)`,
  };
}
