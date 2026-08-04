import type { StudyEvidenceBundle } from "@/contracts";

/** Collect dot-paths that resolve on the bundle (prefix `bundle.`). */
export function enumerateBundleFieldPaths(
  bundle: StudyEvidenceBundle,
): Set<string> {
  const paths = new Set<string>();

  function walk(value: unknown, prefix: string): void {
    paths.add(prefix);
    if (value === null || value === undefined) return;
    if (typeof value !== "object") return;
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${prefix}.${key}`);
    }
  }

  walk(bundle, "bundle");
  return paths;
}

export function resolveBundleFieldPath(
  bundle: StudyEvidenceBundle,
  path: string,
): unknown {
  if (!path.startsWith("bundle.")) return undefined;
  const parts = path.slice("bundle.".length).split(".");
  let current: unknown = bundle;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/** Map common packet-only aliases to bundle paths (LLM grounding shim). */
export function normalizeBundleFieldPath(path: string): string {
  const queryMatch = path.match(/^bundle\.queryMatchFields\.([a-z_]+)$/);
  if (queryMatch) {
    return `bundle.queryContext.matchProfile.fields.${queryMatch[1]!}`;
  }
  return path;
}

export function expandHorizonCitationPaths(
  paths: readonly string[],
): string[] {
  const expanded = new Set(paths.map(normalizeBundleFieldPath));
  for (const path of expanded) {
    const horizonBlock = path.match(/^bundle\.horizonEvidence\.(d\d+)\./);
    if (horizonBlock) {
      expanded.add(`bundle.horizonEvidence.${horizonBlock[1]!}.horizon`);
    }
    if (
      path.startsWith("bundle.horizonEvidence.") ||
      path === "bundle.primaryHorizon" ||
      path.startsWith("bundle.statusBasis.") ||
      path.startsWith("bundle.cohortQuality.")
    ) {
      expanded.add("bundle.primaryHorizon");
      expanded.add("bundle.statusBasis.primaryHorizon");
      expanded.add("bundle.cohortQuality.reasons");
    }
  }
  return [...expanded];
}

export function bundleFieldCorpus(
  bundle: StudyEvidenceBundle,
  paths: readonly string[],
): string {
  const chunks: string[] = [];
  for (const path of expandHorizonCitationPaths(paths)) {
    const value = resolveBundleFieldPath(bundle, path);
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number") {
      chunks.push(String(value));
    } else {
      chunks.push(JSON.stringify(value));
    }
  }
  return chunks.join(" ");
}

export function pathsResolve(
  bundle: StudyEvidenceBundle,
  paths: readonly string[],
  allowed: ReadonlySet<string>,
): { ok: true } | { ok: false; badPath: string } {
  for (const rawPath of paths) {
    const path = normalizeBundleFieldPath(rawPath);
    if (!path.startsWith("bundle.")) {
      return { ok: false, badPath: rawPath };
    }
    if (!allowed.has(path)) {
      return { ok: false, badPath: rawPath };
    }
    if (resolveBundleFieldPath(bundle, path) === undefined) {
      return { ok: false, badPath: rawPath };
    }
  }
  return { ok: true };
}
