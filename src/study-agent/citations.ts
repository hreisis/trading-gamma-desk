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

export function bundleFieldCorpus(
  bundle: StudyEvidenceBundle,
  paths: readonly string[],
): string {
  const chunks: string[] = [];
  for (const path of paths) {
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
  for (const path of paths) {
    if (!path.startsWith("bundle.")) {
      return { ok: false, badPath: path };
    }
    if (!allowed.has(path)) {
      return { ok: false, badPath: path };
    }
    if (resolveBundleFieldPath(bundle, path) === undefined) {
      return { ok: false, badPath: path };
    }
  }
  return { ok: true };
}
