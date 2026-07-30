import type {
  BriefFact,
  OfficialBrief,
  ReleaseObservation,
  ReleaseResult,
} from "@/contracts";
import { BRIEF_METRIC_REGISTRY } from "./registry";

export interface StructuredReleaseIndex {
  /** key: `${releaseFamily}|${referencePeriod}` */
  readonly byKey: ReadonlyMap<string, ReleaseResult>;
}

export function indexStructuredReleases(
  releases: readonly {
    readonly releaseFamily: string;
    readonly referencePeriod: string;
    readonly releaseResult: ReleaseResult;
  }[],
): StructuredReleaseIndex {
  const byKey = new Map<string, ReleaseResult>();
  for (const r of releases) {
    byKey.set(`${r.releaseFamily}|${r.referencePeriod}`, r.releaseResult);
  }
  return { byKey };
}

function findObservation(
  result: ReleaseResult,
  metric: string,
): ReleaseObservation | undefined {
  return result.observations.find((o) => o.metric === metric);
}

/**
 * Annotate facts with crossCheck vs M2-2C1 structured observations.
 * Never overwrites structured results; never fills missing document facts.
 */
export function applyStructuredCrossCheck(
  brief: OfficialBrief,
  index: StructuredReleaseIndex,
): OfficialBrief {
  if (!brief.referencePeriod) return brief;
  // Only CPI / Employment have structured results today.
  if (
    brief.releaseFamily !== "cpi" &&
    brief.releaseFamily !== "employment_situation"
  ) {
    return brief;
  }
  const structured = index.byKey.get(
    `${brief.releaseFamily}|${brief.referencePeriod}`,
  );
  if (!structured) return brief;

  const warnings = [...brief.warnings];
  const facts: BriefFact[] = brief.facts.map((fact) => {
    if (!fact.values || fact.values.length === 0) return fact;
    let annotated = fact;
    for (const v of fact.values) {
      const spec = BRIEF_METRIC_REGISTRY[v.metric];
      if (!spec?.structuredMetric) continue;
      const obs = findObservation(structured, spec.structuredMetric);
      if (!obs) continue;
      const delta = Math.abs(v.value - obs.actual);
      const status = delta <= spec.crossCheckTolerance ? "matched" : "mismatch";
      const crossCheck = {
        status: status as "matched" | "mismatch",
        structuredMetric: spec.structuredMetric,
        structuredActual: obs.actual,
        tolerance: spec.crossCheckTolerance,
      };
      annotated = { ...annotated, crossCheck };
      if (status === "matched") {
        warnings.push(
          `crossCheck:matched:${v.metric}=${v.value} vs structured ${obs.actual} (tol ${spec.crossCheckTolerance})`,
        );
      } else {
        warnings.push(
          `crossCheck:mismatch:${v.metric}=${v.value} vs structured ${obs.actual} (tol ${spec.crossCheckTolerance})`,
        );
      }
    }
    return annotated;
  });

  return { ...brief, facts, warnings };
}
