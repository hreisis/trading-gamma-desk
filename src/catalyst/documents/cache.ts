import { existsSync, readFileSync } from "node:fs";
import { OfficialDocument } from "@/contracts";
import { instantMs } from "../time";
import { DEFAULT_DOCUMENTS_DATA_ROOT, documentsLatestPath } from "./paths";
import type { CatalystDocumentsCache } from "./types";

/** Local documents cache older than this is stale. */
export const DOCUMENTS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type DocumentsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystDocumentsCache;
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

export function parseDocumentsCache(raw: unknown): CatalystDocumentsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("documents cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystDocumentsCache") {
    throw new Error("documents cache: kind must be CatalystDocumentsCache");
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `documents cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.fetchedAt !== "string" || instantMs(o.fetchedAt) === null) {
    throw new Error("documents cache: fetchedAt missing or invalid");
  }
  if (!Array.isArray(o.sources)) {
    throw new Error("documents cache: sources invalid");
  }
  if (!Array.isArray(o.documents)) {
    throw new Error("documents cache: documents must be an array");
  }
  const documents = o.documents.map((d, i) => {
    const parsed = OfficialDocument.safeParse(d);
    if (!parsed.success) {
      throw new Error(
        `documents cache: documents[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  const window = o.requestedWindow as CatalystDocumentsCache["requestedWindow"];
  if (
    !window ||
    typeof window.now !== "string" ||
    typeof window.feedStart !== "string" ||
    typeof window.feedEnd !== "string"
  ) {
    throw new Error("documents cache: requestedWindow invalid");
  }

  return {
    kind: "CatalystDocumentsCache",
    schemaVersion: "0.1.0",
    fetchedAt: o.fetchedAt,
    requestedWindow: window,
    sources: o.sources as CatalystDocumentsCache["sources"],
    documents,
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystDocumentsCache["revisions"])
      : [],
    validationErrors: Array.isArray(o.validationErrors)
      ? (o.validationErrors as CatalystDocumentsCache["validationErrors"])
      : [],
    linkingWarnings: Array.isArray(o.linkingWarnings)
      ? (o.linkingWarnings as CatalystDocumentsCache["linkingWarnings"])
      : [],
    partialFailure: Boolean(o.partialFailure),
  };
}

export function loadDocumentsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): DocumentsCacheLoad {
  const path = documentsLatestPath(
    options.dataRoot ?? DEFAULT_DOCUMENTS_DATA_ROOT,
  );
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Official documents cache missing at ${path}. Run: npm run catalyst:documents:fetch`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseDocumentsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const fetchedMs = instantMs(cache.fetchedAt);
    if (fetchedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "documents cache: fetchedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - fetchedMs);
    const staleAfter = options.staleAfterMs ?? DOCUMENTS_STALE_AFTER_MS;
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
