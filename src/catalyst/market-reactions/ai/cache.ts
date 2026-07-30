import { existsSync, readFileSync } from "node:fs";
import { AiMarketReactionNarrative } from "@/contracts";
import { instantMs } from "../../time";
import {
  DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
  aiMarketReactionsLatestPath,
} from "./paths";
import type { CatalystAiMarketReactionsCache } from "./types";

export const AI_MARKET_REACTIONS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type AiMarketReactionsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystAiMarketReactionsCache;
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

export function parseAiMarketReactionsCache(
  raw: unknown,
): CatalystAiMarketReactionsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("ai market reactions cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystAiMarketReactionsCache") {
    throw new Error(
      "ai market reactions cache: kind must be CatalystAiMarketReactionsCache",
    );
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `ai market reactions cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.generatedAt !== "string" || instantMs(o.generatedAt) === null) {
    throw new Error(
      "ai market reactions cache: generatedAt missing or invalid",
    );
  }
  if (!Array.isArray(o.narratives)) {
    throw new Error("ai market reactions cache: narratives must be an array");
  }
  const narratives = o.narratives.map((n, i) => {
    const parsed = AiMarketReactionNarrative.safeParse(n);
    if (!parsed.success) {
      throw new Error(
        `ai market reactions cache: narratives[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  return {
    kind: "CatalystAiMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt: o.generatedAt,
    provider: String(o.provider ?? "unknown"),
    model: String(o.model ?? "unknown"),
    promptVersion: String(o.promptVersion ?? ""),
    reactionRulesVersion: String(o.reactionRulesVersion ?? ""),
    buildStatus:
      (o.buildStatus as CatalystAiMarketReactionsCache["buildStatus"]) ??
      "ok",
    inputRefs: Array.isArray(o.inputRefs)
      ? (o.inputRefs as CatalystAiMarketReactionsCache["inputRefs"])
      : [],
    narratives,
    usage: Array.isArray(o.usage)
      ? (o.usage as CatalystAiMarketReactionsCache["usage"])
      : [],
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystAiMarketReactionsCache["revisions"])
      : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as CatalystAiMarketReactionsCache["errors"])
      : [],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
  };
}

export function loadAiMarketReactionsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): AiMarketReactionsCacheLoad {
  const path = aiMarketReactionsLatestPath(
    options.dataRoot ?? DEFAULT_AI_MARKET_REACTIONS_DATA_ROOT,
  );
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `AI market reactions cache missing at ${path}. Run: npm run catalyst:market-reactions:enhance`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseAiMarketReactionsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const generatedMs = instantMs(cache.generatedAt);
    if (generatedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "ai market reactions cache: generatedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - generatedMs);
    const staleAfter =
      options.staleAfterMs ?? AI_MARKET_REACTIONS_STALE_AFTER_MS;
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
