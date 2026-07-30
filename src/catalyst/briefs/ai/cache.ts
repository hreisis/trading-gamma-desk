import { existsSync, readFileSync } from "node:fs";
import { OfficialAiBrief } from "@/contracts";
import { instantMs } from "../../time";
import { DEFAULT_AI_BRIEFS_DATA_ROOT, aiBriefsLatestPath } from "./paths";
import type { CatalystAiBriefsCache } from "./types";

export const AI_BRIEFS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type AiBriefsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystAiBriefsCache;
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

export function parseAiBriefsCache(raw: unknown): CatalystAiBriefsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("ai briefs cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystAiBriefsCache") {
    throw new Error("ai briefs cache: kind must be CatalystAiBriefsCache");
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `ai briefs cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.generatedAt !== "string" || instantMs(o.generatedAt) === null) {
    throw new Error("ai briefs cache: generatedAt missing or invalid");
  }
  if (!Array.isArray(o.briefs)) {
    throw new Error("ai briefs cache: briefs must be an array");
  }
  const briefs = o.briefs.map((b, i) => {
    const parsed = OfficialAiBrief.safeParse(b);
    if (!parsed.success) {
      throw new Error(
        `ai briefs cache: briefs[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  return {
    kind: "CatalystAiBriefsCache",
    schemaVersion: "0.1.0",
    generatedAt: o.generatedAt,
    provider: String(o.provider ?? "unknown"),
    model: String(o.model ?? "unknown"),
    promptVersion: String(o.promptVersion ?? ""),
    extractorVersion: String(o.extractorVersion ?? ""),
    buildStatus: (o.buildStatus as CatalystAiBriefsCache["buildStatus"]) ?? "ok",
    inputRefs: Array.isArray(o.inputRefs)
      ? (o.inputRefs as CatalystAiBriefsCache["inputRefs"])
      : [],
    briefs,
    usage: Array.isArray(o.usage)
      ? (o.usage as CatalystAiBriefsCache["usage"])
      : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as CatalystAiBriefsCache["errors"])
      : [],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
  };
}

export function loadAiBriefsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): AiBriefsCacheLoad {
  const path = aiBriefsLatestPath(
    options.dataRoot ?? DEFAULT_AI_BRIEFS_DATA_ROOT,
  );
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `AI briefs cache missing at ${path}. Run: npm run catalyst:briefs:enhance`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseAiBriefsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const generatedMs = instantMs(cache.generatedAt);
    if (generatedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "ai briefs cache: generatedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - generatedMs);
    const staleAfter = options.staleAfterMs ?? AI_BRIEFS_STALE_AFTER_MS;
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
