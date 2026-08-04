import type { StudyEvidenceBundle } from "@/contracts";
import { enumerateBundleFieldPaths, resolveBundleFieldPath } from "./citations";

export interface StudyMemoCitationEntry {
  readonly id: string;
  readonly path: string;
  readonly preview: string;
}

export interface StudyMemoCitationCatalog {
  readonly entries: readonly StudyMemoCitationEntry[];
  readonly idToPath: ReadonlyMap<string, string>;
}

const CITATION_ID_OVERRIDES: Record<string, string> = {
  "bundle.evidenceStatus": "evidence_status",
  "bundle.primaryHorizon": "primary_horizon",
  "bundle.limitations": "limitations",
  "bundle.queryContext.symbol": "symbol",
  "bundle.queryContext.sessionDate": "session_date",
  "bundle.statusBasis.ruleId": "status_basis_rule_id",
  "bundle.statusBasis.primaryHorizon": "status_basis_primary_horizon",
  "bundle.statusBasis.medianReturn": "status_basis_median_return",
  "bundle.statusBasis.meanReturn": "status_basis_mean_return",
  "bundle.statusBasis.positiveRate": "status_basis_positive_rate",
  "bundle.cohortQuality.status": "cohort_status",
  "bundle.cohortQuality.matchedStudyCount": "cohort_matched_study_count",
  "bundle.cohortQuality.rejectedStudyCount": "cohort_rejected_study_count",
  "bundle.cohortQuality.primaryHorizonMatureCount":
    "cohort_primary_horizon_mature_count",
  "bundle.cohortQuality.differentFactorCount": "cohort_different_factor_count",
  "bundle.cohortQuality.warnings": "cohort_warnings",
  "bundle.cohortQuality.reasons": "cohort_reasons",
  "bundle.cohortQuality.matchedStudyIds": "cohort_matched_study_ids",
};

const PRIORITY_PATHS = [
  "bundle.evidenceStatus",
  "bundle.primaryHorizon",
  "bundle.limitations",
  "bundle.queryContext.symbol",
  "bundle.statusBasis.ruleId",
  "bundle.cohortQuality.status",
  "bundle.cohortQuality.matchedStudyCount",
  "bundle.cohortQuality.primaryHorizonMatureCount",
  "bundle.horizonEvidence.d5.horizon",
  "bundle.horizonEvidence.d5.aggregate.meanReturn",
  "bundle.horizonEvidence.d5.aggregate.medianReturn",
  "bundle.horizonEvidence.d5.aggregate.positiveRate",
  "bundle.horizonEvidence.d5.aggregate.meanMfe",
  "bundle.horizonEvidence.d5.aggregate.meanMae",
  "bundle.horizonEvidence.d5.aggregate.status",
  "bundle.horizonEvidence.d20.aggregate.status",
  "bundle.horizonEvidence.d20.aggregate.reason",
  "bundle.cohortQuality.warnings",
] as const;

function citationIdForPath(path: string): string {
  if (CITATION_ID_OVERRIDES[path]) {
    return CITATION_ID_OVERRIDES[path]!;
  }
  let id = path
    .slice("bundle.".length)
    .replace(/^queryContext\.matchProfile\.fields\./, "match_")
    .replace(/^horizonEvidence\.(d\d+)\.aggregate\./, "$1_")
    .replace(/^horizonEvidence\.(d\d+)\./, "$1_")
    .replace(/\./g, "_");
  return id;
}

function uniqueCitationId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

function formatPreview(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} items]`;
  }
  return JSON.stringify(value).slice(0, 120);
}

function sortedCatalogPaths(allowed: ReadonlySet<string>): string[] {
  const paths = [...allowed].filter(
    (path) => path.startsWith("bundle.") && !path.includes("["),
  );
  paths.sort();
  const priority = new Set<string>(PRIORITY_PATHS);
  const front = PRIORITY_PATHS.filter((path) => paths.includes(path));
  const rest = paths.filter((path) => !priority.has(path));
  return [...front, ...rest];
}

/**
 * Deterministic allowed citation catalog from the exact StudyEvidenceBundle input.
 * Array-valued fields (e.g. limitations) are whole-field paths only — never indexed.
 */
export function buildCitationCatalog(
  bundle: StudyEvidenceBundle,
): StudyMemoCitationCatalog {
  const allowed = enumerateBundleFieldPaths(bundle);
  const usedIds = new Set<string>();
  const entries: StudyMemoCitationEntry[] = [];
  const idToPath = new Map<string, string>();

  for (const path of sortedCatalogPaths(allowed)) {
    const value = resolveBundleFieldPath(bundle, path);
    if (value === undefined) continue;
    const id = uniqueCitationId(citationIdForPath(path), usedIds);
    entries.push({ id, path, preview: formatPreview(value) });
    idToPath.set(id, path);
  }

  return { entries, idToPath };
}

export const REQUIRED_FIRST_EVIDENCE_CITATION_IDS = [
  "evidence_status",
  "primary_horizon",
] as const;
