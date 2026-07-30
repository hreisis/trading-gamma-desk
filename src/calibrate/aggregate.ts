import type { DayRecord } from "./replay";

export interface Distribution {
  readonly n: number;
  readonly min: number | null;
  readonly p25: number | null;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

export interface CalibrationReport {
  readonly kind: "MacroCalibrationReport";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly sample: {
    readonly firstSession: string | null;
    readonly lastSession: string | null;
    readonly dayCount: number;
    readonly minHistorySessions: number;
    readonly note: string;
  };
  readonly regimeFrequency: Record<string, number>;
  readonly fallbackFrequency: {
    readonly mixed_unresolved: number;
    readonly single_asset_shock: number;
    readonly insufficient_data: number;
  };
  readonly polarityFrequency: Record<string, number>;
  readonly riskDirectionFrequency: Record<string, number>;
  readonly hardCapFrequency: Record<string, number>;
  readonly zeroedByFrequency: Record<string, number>;
  readonly completeSessionRate: number;
  readonly distributions: {
    readonly confidenceScore: Distribution;
    readonly winnerMargin: Distribution;
    readonly patternMatch: Distribution;
    readonly distinctiveness: Distribution;
    readonly coherence: Distribution;
    readonly effectiveBreadth: Distribution;
    readonly strength: Distribution;
    readonly coveragePenalty: Distribution;
    readonly effectiveConfirmations: Distribution;
    readonly observedZCount: Distribution;
  };
  readonly confidenceBuckets: Record<string, number>;
  readonly scenarioConstraints: {
    readonly note: string;
    readonly fixturePath: string;
    readonly results: {
      readonly id: string;
      readonly expectedRegime: string;
      readonly observedRegime: string;
      readonly ok: boolean;
    }[];
  };
  readonly parameterSuggestions: {
    readonly status: "review_only";
    readonly calibratedRemains: false;
    readonly items: {
      readonly parameter: string;
      readonly current: number | string | boolean;
      readonly observation: string;
      readonly suggestion: string;
      readonly caution: string;
    }[];
  };
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function distributionOf(
  values: readonly (number | null | undefined)[],
): Distribution {
  const xs = values.filter((v): v is number => v !== null && v !== undefined);
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return {
      n: 0,
      min: null,
      p25: null,
      p50: null,
      p75: null,
      max: null,
      mean: null,
    };
  }
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    min: sorted[0]!,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted[n - 1]!,
    mean,
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

function confidenceBuckets(scores: readonly number[]): Record<string, number> {
  const buckets: Record<string, number> = {
    "0": 0,
    "1-19": 0,
    "20-39": 0,
    "40-59": 0,
    "60-69": 0,
    "70-84": 0,
    "85-100": 0,
  };
  for (const s of scores) {
    if (s === 0) buckets["0"]! += 1;
    else if (s < 20) buckets["1-19"]! += 1;
    else if (s < 40) buckets["20-39"]! += 1;
    else if (s < 60) buckets["40-59"]! += 1;
    else if (s < 70) buckets["60-69"]! += 1;
    else if (s < 85) buckets["70-84"]! += 1;
    else buckets["85-100"]! += 1;
  }
  return buckets;
}

export function buildParameterSuggestions(
  records: readonly DayRecord[],
  params: {
    readonly marginRef: number;
    readonly ambiguityFloor: number;
    readonly concentrationThreshold: number;
    readonly highBandFloor: number;
  },
): CalibrationReport["parameterSuggestions"] {
  const n = records.length;
  const fallbacks = {
    mixed: records.filter((r) => r.primaryRegime === "mixed_unresolved").length,
    shock: records.filter((r) => r.primaryRegime === "single_asset_shock").length,
    insuff: records.filter((r) => r.primaryRegime === "insufficient_data")
      .length,
  };
  const driverDays = records.filter(
    (r) =>
      r.primaryRegime !== "mixed_unresolved" &&
      r.primaryRegime !== "single_asset_shock" &&
      r.primaryRegime !== "insufficient_data",
  );
  const margins = driverDays
    .map((r) => r.winnerMargin)
    .filter((v): v is number => v !== null);
  const dist = distributionOf(margins);
  const distinct = distributionOf(driverDays.map((r) => r.distinctiveness));
  const breadth = distributionOf(driverDays.map((r) => r.effectiveBreadth));
  const scores = distributionOf(driverDays.map((r) => r.confidenceScore));
  const thinCap = records.filter((r) =>
    r.hardCapRules.includes("insufficient_effective_confirmations"),
  ).length;
  const aboveHigh = driverDays.filter(
    (r) => r.confidenceScore >= params.highBandFloor,
  ).length;

  return {
    status: "review_only",
    calibratedRemains: false,
    items: [
      {
        parameter: "ambiguityFloor",
        current: params.ambiguityFloor,
        observation: `mixed_unresolved on ${fallbacks.mixed}/${n} days (${((100 * fallbacks.mixed) / Math.max(n, 1)).toFixed(1)}%); driver-day distinctiveness p50=${distinct.p50?.toFixed(3) ?? "n/a"}.`,
        suggestion:
          fallbacks.mixed / Math.max(n, 1) > 0.35
            ? "Sample is mixed-heavy; consider raising ambiguityFloor only after a larger history confirms chronic ties — do not raise from this window alone."
            : fallbacks.mixed / Math.max(n, 1) < 0.05 &&
                (distinct.p50 ?? 1) > params.ambiguityFloor * 2
              ? "Few mixed days and healthy separation; a modest increase in ambiguityFloor could be tested later to keep near-ties honest."
              : "Keep ambiguityFloor unchanged until the live sample is larger than ~60 driver days.",
        caution:
          "Hand scenarios already pin the gate wiring; fitting the floor to ~30 warm days will overfit seasonality.",
      },
      {
        parameter: "marginRef",
        current: params.marginRef,
        observation: `Driver-day |s_top|-|s_second| p50=${dist.p50?.toFixed(3) ?? "n/a"}, p75=${dist.p75?.toFixed(3) ?? "n/a"}.`,
        suggestion:
          dist.p50 !== null && dist.p50 < params.marginRef * 0.5
            ? "Typical margins sit well below marginRef, so distinctiveness rarely approaches 1 — consider a lower marginRef only after confirming this is not a quiet-vol artifact."
            : "Keep marginRef; the current scale is not obviously misaligned with observed margins.",
        caution:
          "marginRef also scales with templateSimilarity; changing it moves mixed_unresolved and confidence together.",
      },
      {
        parameter: "concentrationThreshold",
        current: params.concentrationThreshold,
        observation: `single_asset_shock on ${fallbacks.shock}/${n} days; thin-breadth cap fired on ${thinCap}/${n} days.`,
        suggestion:
          fallbacks.shock === 0
            ? "No shocks in this window — do not loosen the threshold; wait for a violent single-name day in a longer sample."
            : "Keep concentrationThreshold; shocks are present and the gate is exercising.",
        caution: "This threshold is a hard regime override, not a soft score knob.",
      },
      {
        parameter: "lambda (component weights)",
        current: "equal 0.2 each",
        observation: `Driver-day breadth p50=${breadth.p50?.toFixed(3) ?? "n/a"}; strength enters confidence but cosine components dominate regime choice.`,
        suggestion:
          "Keep equal λ until M1-6b has enough days to estimate which components predict stable next-day regime persistence.",
        caution: "Reweighting λ without an outcome label is decoration, not calibration.",
      },
      {
        parameter: "highBandFloor / confidence bands",
        current: params.highBandFloor,
        observation: `Driver-day confidence p50=${scores.p50?.toFixed(1) ?? "n/a"}; ${aboveHigh}/${driverDays.length} driver days score ≥ ${params.highBandFloor}.`,
        suggestion:
          "Leave bands unpublished (calibrated: false). The 70 placeholder is fine as a thin-breadth cap only; do not invent high/medium/low cut-offs from this sample.",
        caution:
          "Publishing band labels before outcome-linked calibration is exactly what the product forbids.",
      },
      {
        parameter: "calibrated",
        current: false,
        observation: `Replay covers ${n} sessions after warm-up; insufficient_data=${fallbacks.insuff}.`,
        suggestion: "Keep calibrated: false until a multi-quarter PIT sample exists and band cut-offs are outcome-checked.",
        caution: "Scenario fixtures constrain semantics; they must not be the sole fit target.",
      },
    ],
  };
}

export function aggregateRecords(
  records: readonly DayRecord[],
  options: {
    readonly minHistorySessions: number;
    readonly scenarioConstraints: CalibrationReport["scenarioConstraints"];
    readonly parameterSuggestions: CalibrationReport["parameterSuggestions"];
  },
): CalibrationReport {
  const regimes = countBy(records.map((r) => r.primaryRegime));
  const hardCaps = countBy(records.flatMap((r) => r.hardCapRules));
  const zeroed = countBy(
    records
      .map((r) => r.zeroedBy)
      .filter((z): z is string => z !== null),
  );

  return {
    kind: "MacroCalibrationReport",
    schemaVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
    sample: {
      firstSession: records[0]?.marketSessionDate ?? null,
      lastSession: records.at(-1)?.marketSessionDate ?? null,
      dayCount: records.length,
      minHistorySessions: options.minHistorySessions,
      note:
        "Aggregates only. Point-in-time replay over local data/bars (gitignored). No Tiingo raw prints are embedded. Scenario fixtures remain semantic constraints, not the fit target.",
    },
    regimeFrequency: regimes,
    fallbackFrequency: {
      mixed_unresolved: regimes.mixed_unresolved ?? 0,
      single_asset_shock: regimes.single_asset_shock ?? 0,
      insufficient_data: regimes.insufficient_data ?? 0,
    },
    polarityFrequency: countBy(
      records.map((r) => r.polarity ?? "null"),
    ),
    riskDirectionFrequency: countBy(
      records.map((r) => r.riskDirection ?? "null"),
    ),
    hardCapFrequency: hardCaps,
    zeroedByFrequency: zeroed,
    completeSessionRate:
      records.filter((r) => r.isCompleteSession).length /
      Math.max(records.length, 1),
    distributions: {
      confidenceScore: distributionOf(records.map((r) => r.confidenceScore)),
      winnerMargin: distributionOf(records.map((r) => r.winnerMargin)),
      patternMatch: distributionOf(records.map((r) => r.patternMatch)),
      distinctiveness: distributionOf(records.map((r) => r.distinctiveness)),
      coherence: distributionOf(records.map((r) => r.coherence)),
      effectiveBreadth: distributionOf(records.map((r) => r.effectiveBreadth)),
      strength: distributionOf(records.map((r) => r.strength)),
      coveragePenalty: distributionOf(records.map((r) => r.coveragePenalty)),
      effectiveConfirmations: distributionOf(
        records.map((r) => r.effectiveConfirmations),
      ),
      observedZCount: distributionOf(records.map((r) => r.observedZCount)),
    },
    confidenceBuckets: confidenceBuckets(
      records.map((r) => r.confidenceScore),
    ),
    scenarioConstraints: options.scenarioConstraints,
    parameterSuggestions: options.parameterSuggestions,
  };
}
