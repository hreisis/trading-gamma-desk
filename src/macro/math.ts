/** Clamp into the closed unit interval. */
export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

export function l2(values: readonly number[]): number {
  return Math.sqrt(dot(values, values));
}

export function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(dot(values, values) / values.length);
}

/**
 * Cosine of two equal-length vectors. Returns null when either side has
 * zero length, because the angle is then undefined rather than zero.
 */
export function cosine(
  a: readonly number[],
  b: readonly number[],
): number | null {
  if (a.length !== b.length) {
    throw new Error(`cosine length mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) return null;
  const na = l2(a);
  const nb = l2(b);
  if (na === 0 || nb === 0) return null;
  // Clamp floating noise so the result stays inside the contract's [-1, 1].
  return Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
}

/**
 * Weighted geometric mean. Any non-positive component forces an explicit
 * zero rather than a tiny product that would look like a calibrated score.
 */
export function weightedGeometricMean(
  components: readonly { value: number; weight: number }[],
): { gate: number; zeroedIndex: number | null } {
  for (const [i, component] of components.entries()) {
    if (component.value <= 0) {
      return { gate: 0, zeroedIndex: i };
    }
  }
  let logSum = 0;
  for (const component of components) {
    logSum += component.weight * Math.log(component.value);
  }
  return { gate: Math.exp(logSum), zeroedIndex: null };
}
