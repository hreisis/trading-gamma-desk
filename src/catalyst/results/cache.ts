import { existsSync, readFileSync } from "node:fs";
import { ReleaseResult } from "@/contracts";
import { DEFAULT_RESULTS_DATA_ROOT, resultsLatestPath } from "./paths";
import { instantMs } from "../time";
import type { CatalystResultsCache, BuiltRelease } from "./types";

/** Local results cache older than this is stale. */
export const RESULTS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type ResultsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystResultsCache;
      readonly stale: boolean;
      readonly ageMs: number;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly reason: "missing" | "malformed";
      readonly error: string;
      readonly path: string;
    };

function parseBuiltRelease(raw: unknown, index: number): BuiltRelease {
  if (!raw || typeof raw !== "object") {
    throw new Error(`results cache: releases[${index}] invalid`);
  }
  const o = raw as Record<string, unknown>;
  if (o.releaseFamily !== "cpi" && o.releaseFamily !== "employment_situation") {
    throw new Error(`results cache: releases[${index}] bad releaseFamily`);
  }
  if (typeof o.referencePeriod !== "string" || typeof o.observedAt !== "string") {
    throw new Error(`results cache: releases[${index}] missing period/observedAt`);
  }
  if (typeof o.fingerprint !== "string") {
    throw new Error(`results cache: releases[${index}] missing fingerprint`);
  }
  const rr = ReleaseResult.safeParse(o.releaseResult);
  if (!rr.success) {
    throw new Error(
      `results cache: releases[${index}].releaseResult invalid: ${rr.error.issues[0]?.message ?? "schema"}`,
    );
  }
  if (!Array.isArray(o.observations)) {
    throw new Error(`results cache: releases[${index}] observations invalid`);
  }
  return {
    releaseFamily: o.releaseFamily,
    referencePeriod: o.referencePeriod,
    observedAt: o.observedAt,
    fingerprint: o.fingerprint,
    observations: rr.data.observations,
    releaseResult: rr.data,
  };
}

export function parseResultsCache(raw: unknown): CatalystResultsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("results cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystResultsCache") {
    throw new Error("results cache: kind must be CatalystResultsCache");
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(`results cache: unsupported schemaVersion ${String(o.schemaVersion)}`);
  }
  if (typeof o.fetchedAt !== "string" || instantMs(o.fetchedAt) === null) {
    throw new Error("results cache: fetchedAt missing or invalid");
  }
  if (!Array.isArray(o.sources)) {
    throw new Error("results cache: sources invalid");
  }
  if (!Array.isArray(o.releases)) {
    throw new Error("results cache: releases must be an array");
  }
  const releases = o.releases.map((r, i) => parseBuiltRelease(r, i));

  return {
    kind: "CatalystResultsCache",
    schemaVersion: "0.1.0",
    fetchedAt: o.fetchedAt,
    sources: o.sources as CatalystResultsCache["sources"],
    seriesMetadata: Array.isArray(o.seriesMetadata)
      ? (o.seriesMetadata as CatalystResultsCache["seriesMetadata"])
      : [],
    releases,
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystResultsCache["revisions"])
      : [],
    validationErrors: Array.isArray(o.validationErrors)
      ? (o.validationErrors as CatalystResultsCache["validationErrors"])
      : [],
    linkingWarnings: Array.isArray(o.linkingWarnings)
      ? (o.linkingWarnings as CatalystResultsCache["linkingWarnings"])
      : [],
    partialFailure: Boolean(o.partialFailure),
  };
}

export function loadResultsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): ResultsCacheLoad {
  const path = resultsLatestPath(options.dataRoot ?? DEFAULT_RESULTS_DATA_ROOT);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Official results cache missing at ${path}. Run: npm run catalyst:results:fetch`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseResultsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const fetchedMs = instantMs(cache.fetchedAt);
    if (fetchedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "results cache: fetchedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - fetchedMs);
    const staleAfter = options.staleAfterMs ?? RESULTS_STALE_AFTER_MS;
    return {
      ok: true,
      cache,
      stale: ageMs > staleAfter,
      ageMs,
      path,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "malformed",
      error: message,
      path,
    };
  }
}
