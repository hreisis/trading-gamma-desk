import {
  ALL_SYMBOLS,
  MacroSymbol,
  Regime,
  type RegimeSignatureConfig,
} from "@/contracts";
import { cosine } from "./math";

/**
 * Per-asset inputs the scorer needs. Full MacroFeature objects are richer;
 * scoring only looks at the z-score and whether the observation is usable.
 */
export interface ScoreInput {
  readonly symbol: MacroSymbol;
  /** Null when the session change or its scale is unavailable. */
  readonly zScore: number | null;
  /** True when the observation belongs to an earlier session than the cut. */
  readonly stale?: boolean;
}

export interface RegimeScore {
  readonly regime: Regime;
  /** Cosine over observed dims, or null when either vector is degenerate. */
  readonly score: number | null;
}

/**
 * Restrict both the weight vector and the z-vector to dimensions that have a
 * usable z-score, then take their cosine. Re-normalizing on the observed
 * subspace is what keeps a missing asset from silently zeroing a component
 * of the template and pretending the day still matches it fully.
 */
export function scoreRegime(
  weights: Readonly<Partial<Record<MacroSymbol, number>>>,
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
): number | null {
  const w: number[] = [];
  const z: number[] = [];
  for (const symbol of ALL_SYMBOLS) {
    const zi = zBySymbol.get(symbol);
    if (zi === undefined) continue;
    w.push(weights[symbol] ?? 0);
    z.push(zi);
  }
  return cosine(w, z);
}

export function scoreAllRegimes(
  config: RegimeSignatureConfig,
  zBySymbol: ReadonlyMap<MacroSymbol, number>,
): RegimeScore[] {
  return (Object.keys(config.signatures) as Regime[]).map((regime) => ({
    regime,
    score: scoreRegime(config.signatures[regime] ?? {}, zBySymbol),
  }));
}

/**
 * Pick the regime whose absolute cosine is largest. Ties break by the order
 * the signatures appear in the config, which is stable for a given version.
 */
export function pickWinner(scores: readonly RegimeScore[]): {
  winner: RegimeScore | null;
  runnerUp: RegimeScore | null;
} {
  const ranked = scores
    .filter((s) => s.score !== null)
    .slice()
    .sort((a, b) => Math.abs(b.score!) - Math.abs(a.score!));

  return {
    winner: ranked[0] ?? null,
    runnerUp: ranked[1] ?? null,
  };
}

/** Build the observed z map; stale or null z-scores are simply absent. */
export function observedZ(
  inputs: readonly ScoreInput[],
): Map<MacroSymbol, number> {
  const map = new Map<MacroSymbol, number>();
  for (const input of inputs) {
    if (input.zScore === null) continue;
    // Stale observations still participate in the cosine (coveragePenalty
    // accounts for them), matching the contract's "missing or stale" wording
    // for the penalty rather than for the score itself.
    map.set(input.symbol, input.zScore);
  }
  return map;
}
