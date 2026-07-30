import type { CatalystReleaseFamily, ReleaseObservation } from "@/contracts";
import {
  BLS_RELEASE_PAGE_URL,
  BLS_RESULTS_SOURCE_NAME,
  BLS_SERIES_REGISTRY,
  seriesSpecsForFamily,
  type BlsSeriesSpec,
} from "./registry";
import {
  momPercentChange,
  payrollMonthlyChangeThousands,
  yoyPercentChange,
} from "./transforms";
import type { BlsSeriesData, BlsSeriesPoint, BuiltRelease } from "./types";

function pointMap(series: BlsSeriesData | undefined): Map<string, BlsSeriesPoint> {
  const map = new Map<string, BlsSeriesPoint>();
  if (!series) return map;
  for (const p of series.points) map.set(p.referencePeriod, p);
  return map;
}

function priorMonth(period: string): string | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

function yearAgo(period: string): string | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) - 1}-${m[2]}`;
}

function observationFingerprint(obs: readonly ReleaseObservation[]): string {
  return obs
    .map(
      (o) =>
        `${o.metric}:${o.sourceSeriesId}:${o.sourcePeriod}:${o.actual}:${o.transformation}:${o.preliminary ? "P" : ""}`,
    )
    .sort()
    .join("|");
}

function buildObservation(
  spec: BlsSeriesSpec,
  bySeries: Map<string, Map<string, BlsSeriesPoint>>,
  referencePeriod: string,
): ReleaseObservation | null {
  const levels = bySeries.get(spec.levelSeriesId);
  const current = levels?.get(referencePeriod);
  if (!current) return null;

  if (spec.transformation === "level") {
    return {
      metric: spec.metric,
      actual: current.value,
      unit: spec.unit,
      sourceSeriesId: spec.levelSeriesId,
      sourcePeriod: current.sourcePeriod,
      transformation: "level",
      ...(current.preliminary ? { preliminary: true } : {}),
    };
  }

  if (spec.transformation === "mom-change") {
    const prevPeriod = priorMonth(referencePeriod);
    const prev = prevPeriod ? levels?.get(prevPeriod) : undefined;
    if (!prev) return null;
    const actual =
      spec.unit === "thousands"
        ? payrollMonthlyChangeThousands(current.value, prev.value)
        : momPercentChange(current.value, prev.value);
    if (actual === null) return null;
    return {
      metric: spec.metric,
      actual,
      unit: spec.unit,
      sourceSeriesId: spec.levelSeriesId,
      sourcePeriod: current.sourcePeriod,
      transformation: "mom-change",
      ...(current.preliminary ? { preliminary: true } : {}),
    };
  }

  // yoy-change
  const yaPeriod = yearAgo(referencePeriod);
  const ya = yaPeriod ? levels?.get(yaPeriod) : undefined;
  if (!ya) return null;
  const actual = yoyPercentChange(current.value, ya.value);
  if (actual === null) return null;
  return {
    metric: spec.metric,
    actual,
    unit: spec.unit,
    sourceSeriesId: spec.levelSeriesId,
    sourcePeriod: current.sourcePeriod,
    transformation: "yoy-change",
    ...(current.preliminary ? { preliminary: true } : {}),
  };
}

function periodsForFamily(
  family: CatalystReleaseFamily,
  bySeries: Map<string, Map<string, BlsSeriesPoint>>,
): string[] {
  const specs = seriesSpecsForFamily(family);
  const periods = new Set<string>();
  for (const spec of specs) {
    const map = bySeries.get(spec.levelSeriesId);
    if (!map) continue;
    for (const p of map.keys()) periods.add(p);
  }
  return [...periods].sort();
}

/**
 * Build release bundles from parsed BLS series. Only periods with at least one
 * complete observation for the family are emitted.
 */
export function buildReleasesFromSeries(
  series: readonly BlsSeriesData[],
  observedAt: string,
): {
  readonly releases: BuiltRelease[];
  readonly validationErrors: Array<{ error: string; path?: string }>;
} {
  const bySeries = new Map<string, Map<string, BlsSeriesPoint>>();
  for (const s of series) {
    bySeries.set(s.seriesId, pointMap(s));
  }

  const validationErrors: Array<{ error: string; path?: string }> = [];
  for (const id of new Set(BLS_SERIES_REGISTRY.map((r) => r.levelSeriesId))) {
    if (!bySeries.has(id)) {
      validationErrors.push({
        error: `Missing series ${id} in BLS API response`,
        path: id,
      });
    }
  }

  const families: CatalystReleaseFamily[] = ["cpi", "employment_situation"];
  const releases: BuiltRelease[] = [];

  for (const family of families) {
    const specs = seriesSpecsForFamily(family);
    for (const referencePeriod of periodsForFamily(family, bySeries)) {
      const observations: ReleaseObservation[] = [];
      for (const spec of specs) {
        const obs = buildObservation(spec, bySeries, referencePeriod);
        if (obs) observations.push(obs);
      }
      if (observations.length === 0) continue;

      const fingerprint = observationFingerprint(observations);
      releases.push({
        releaseFamily: family,
        referencePeriod,
        observedAt,
        observations,
        fingerprint,
        releaseResult: {
          referencePeriod,
          observedAt,
          sourceName: BLS_RESULTS_SOURCE_NAME,
          sourceUrl: BLS_RELEASE_PAGE_URL[family],
          observations,
          consensus: null,
          surprise: null,
          surpriseStatus: "unavailable",
        },
      });
    }
  }

  releases.sort((a, b) => {
    const byPeriod =
      a.referencePeriod < b.referencePeriod
        ? 1
        : a.referencePeriod > b.referencePeriod
          ? -1
          : 0;
    if (byPeriod !== 0) return byPeriod;
    return a.releaseFamily < b.releaseFamily
      ? -1
      : a.releaseFamily > b.releaseFamily
        ? 1
        : 0;
  });

  return { releases, validationErrors };
}

export { observationFingerprint };
