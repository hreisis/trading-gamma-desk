import { existsSync, readFileSync } from "node:fs";
import { OfficialBrief } from "@/contracts";
import { instantMs } from "../time";
import { DEFAULT_BRIEFS_DATA_ROOT, briefsLatestPath } from "./paths";
import type { CatalystBriefsCache } from "./types";

export const BRIEFS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type BriefsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystBriefsCache;
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

export function parseBriefsCache(raw: unknown): CatalystBriefsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("briefs cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystBriefsCache") {
    throw new Error("briefs cache: kind must be CatalystBriefsCache");
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `briefs cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.generatedAt !== "string" || instantMs(o.generatedAt) === null) {
    throw new Error("briefs cache: generatedAt missing or invalid");
  }
  if (typeof o.extractorVersion !== "string") {
    throw new Error("briefs cache: extractorVersion missing");
  }
  if (!Array.isArray(o.briefs)) {
    throw new Error("briefs cache: briefs must be an array");
  }
  const briefs = o.briefs.map((b, i) => {
    const parsed = OfficialBrief.safeParse(b);
    if (!parsed.success) {
      throw new Error(
        `briefs cache: briefs[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  return {
    kind: "CatalystBriefsCache",
    schemaVersion: "0.1.0",
    generatedAt: o.generatedAt,
    extractorVersion: o.extractorVersion,
    buildStatus: (o.buildStatus as CatalystBriefsCache["buildStatus"]) ?? "ok",
    inputDocuments: Array.isArray(o.inputDocuments)
      ? (o.inputDocuments as CatalystBriefsCache["inputDocuments"])
      : [],
    briefs,
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystBriefsCache["revisions"])
      : [],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as CatalystBriefsCache["errors"])
      : [],
  };
}

export function loadBriefsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): BriefsCacheLoad {
  const path = briefsLatestPath(options.dataRoot ?? DEFAULT_BRIEFS_DATA_ROOT);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Official briefs cache missing at ${path}. Run: npm run catalyst:briefs:build`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseBriefsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const generatedMs = instantMs(cache.generatedAt);
    if (generatedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "briefs cache: generatedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - generatedMs);
    const staleAfter = options.staleAfterMs ?? BRIEFS_STALE_AFTER_MS;
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
