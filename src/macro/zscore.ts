/** Consistency factor making MAD a normal-consistent estimator of sigma. */
export const MAD_TO_SIGMA = 1.4826;

/**
 * Median of |x|, taken about zero rather than about the sample median.
 * The z-score numerator assumes a zero mean, so the scale must be estimated
 * about zero too; mixing a median-centred spread with a zero-centred numerator
 * would be two different conventions in one ratio.
 */
export function medianAbsoluteAboutZero(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median requires at least one value");
  }
  const magnitudes = values.map(Math.abs).sort((a, b) => a - b);
  const mid = Math.floor(magnitudes.length / 2);
  if (magnitudes.length % 2 === 1) {
    return magnitudes[mid]!;
  }
  return (magnitudes[mid - 1]! + magnitudes[mid]!) / 2;
}

export function sigmaRawFromChanges(changes: readonly number[]): number {
  return MAD_TO_SIGMA * medianAbsoluteAboutZero(changes);
}

export interface FlooredSigma {
  sigmaUsed: number;
  floorApplied: boolean;
}

/**
 * The floor only rescues a small but non-zero scale. A zero sigma is a data
 * problem, not a quiet market, and flooring it would manufacture a z-score out
 * of repeated prints.
 */
export function applySigmaFloor(
  sigmaRaw: number,
  floor: number | undefined,
): FlooredSigma {
  if (sigmaRaw <= 0) {
    return { sigmaUsed: sigmaRaw, floorApplied: false };
  }
  if (floor !== undefined && sigmaRaw < floor) {
    return { sigmaUsed: floor, floorApplied: true };
  }
  return { sigmaUsed: sigmaRaw, floorApplied: false };
}

export function zScoreOf(change: number, sigmaUsed: number): number {
  return change / sigmaUsed;
}
