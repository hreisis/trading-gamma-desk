/**
 * Centralized, deterministic transforms for BLS release observations.
 * Percent changes keep three decimal places; payroll changes are integers.
 */

export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Month-over-month percent change from index levels. */
export function momPercentChange(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return roundTo(((current / previous) - 1) * 100, 3);
}

/** Year-over-year percent change from index levels. */
export function yoyPercentChange(
  current: number,
  yearAgo: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(yearAgo) || yearAgo === 0) {
    return null;
  }
  return roundTo(((current / yearAgo) - 1) * 100, 3);
}

/** Payroll monthly change in thousands (current level − prior month level). */
export function payrollMonthlyChangeThousands(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Math.round(current - previous);
}
