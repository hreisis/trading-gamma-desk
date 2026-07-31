import { DEFAULT_MAX_EXPECTED_CONTRACTS } from "./config";

export class MarketDataAppStrikeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MarketDataAppStrikeError";
    this.code = code;
  }
}

export interface StrikeRangeInput {
  readonly strikeMin: number;
  readonly strikeMax: number;
  readonly strikeStep?: number;
  readonly maxExpectedContracts?: number;
  /** Explicit override required to exceed the hard safety cap. */
  readonly allowAboveCap?: boolean;
}

export interface StrikeRangePlan {
  readonly strikes: readonly number[];
  readonly strikeMin: number;
  readonly strikeMax: number;
  readonly strikeStep: number;
  readonly strikeCount: number;
  readonly estimatedMaxContracts: number;
  readonly maxExpectedContracts: number;
}

export function buildStrikeList(
  strikeMin: number,
  strikeMax: number,
  strikeStep: number,
): number[] {
  if (!Number.isFinite(strikeMin) || !Number.isFinite(strikeMax)) {
    throw new MarketDataAppStrikeError(
      "invalid_range",
      "strike-min and strike-max must be finite numbers",
    );
  }
  if (!Number.isFinite(strikeStep) || strikeStep <= 0) {
    throw new MarketDataAppStrikeError(
      "invalid_step",
      "strike-step must be a positive finite number",
    );
  }
  if (strikeMin > strikeMax) {
    throw new MarketDataAppStrikeError(
      "invalid_range",
      `strike-min (${strikeMin}) must be <= strike-max (${strikeMax})`,
    );
  }

  const strikes: number[] = [];
  // Integer-friendly loop: avoid float drift for step=1 ranges.
  const steps = Math.round((strikeMax - strikeMin) / strikeStep);
  for (let i = 0; i <= steps; i++) {
    const strike = strikeMin + i * strikeStep;
    if (strike > strikeMax + 1e-9) break;
    strikes.push(Number(strike.toFixed(8)));
  }
  if (strikes.length === 0) {
    throw new MarketDataAppStrikeError(
      "invalid_range",
      "strike range produced zero strikes",
    );
  }
  const last = strikes[strikes.length - 1]!;
  if (Math.abs(last - strikeMax) > 1e-6 && !strikes.includes(strikeMax)) {
    // Ensure max is included when it lands on the grid; otherwise reject misaligned max.
    const remainder = (strikeMax - strikeMin) % strikeStep;
    if (Math.abs(remainder) > 1e-9 && Math.abs(remainder - strikeStep) > 1e-9) {
      throw new MarketDataAppStrikeError(
        "invalid_range",
        `strike-max ${strikeMax} is not aligned to strike-min ${strikeMin} with step ${strikeStep}`,
      );
    }
  }
  return strikes;
}

/**
 * Plan a credit-bounded strike list. Estimated max contracts = strikeCount × 2.
 */
export function planBoundedStrikeRange(input: StrikeRangeInput): StrikeRangePlan {
  const strikeStep = input.strikeStep ?? 1;
  const maxExpectedContracts =
    input.maxExpectedContracts ?? DEFAULT_MAX_EXPECTED_CONTRACTS;
  if (!Number.isFinite(maxExpectedContracts) || maxExpectedContracts <= 0) {
    throw new MarketDataAppStrikeError(
      "invalid_cap",
      "max expected contracts must be a positive number",
    );
  }

  const strikes = buildStrikeList(input.strikeMin, input.strikeMax, strikeStep);
  const strikeCount = strikes.length;
  const estimatedMaxContracts = strikeCount * 2;

  if (
    estimatedMaxContracts > maxExpectedContracts &&
    !input.allowAboveCap
  ) {
    throw new MarketDataAppStrikeError(
      "safety_cap",
      `estimated max contracts ${estimatedMaxContracts} (strikes=${strikeCount}×2) exceeds safety cap ${maxExpectedContracts}; pass --allow-above-cap to override`,
    );
  }

  return {
    strikes,
    strikeMin: input.strikeMin,
    strikeMax: input.strikeMax,
    strikeStep,
    strikeCount,
    estimatedMaxContracts,
    maxExpectedContracts,
  };
}
