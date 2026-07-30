import { existsSync, readFileSync } from "node:fs";
import { EventMarketReaction } from "@/contracts";
import { instantMs } from "../time";
import {
  DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  marketReactionsLatestPath,
} from "./paths";
import type { CatalystMarketReactionsCache } from "./types";

export const MARKET_REACTIONS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type MarketReactionsCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystMarketReactionsCache;
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

export function parseMarketReactionsCache(
  raw: unknown,
): CatalystMarketReactionsCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("market reactions cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystMarketReactionsCache") {
    throw new Error(
      "market reactions cache: kind must be CatalystMarketReactionsCache",
    );
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `market reactions cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.generatedAt !== "string" || instantMs(o.generatedAt) === null) {
    throw new Error("market reactions cache: generatedAt missing or invalid");
  }
  if (!Array.isArray(o.reactions)) {
    throw new Error("market reactions cache: reactions must be an array");
  }
  const reactions = o.reactions.map((r, i) => {
    const parsed = EventMarketReaction.safeParse(r);
    if (!parsed.success) {
      throw new Error(
        `market reactions cache: reactions[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  return {
    kind: "CatalystMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt: o.generatedAt,
    reactionRulesVersion: String(o.reactionRulesVersion ?? ""),
    buildStatus:
      (o.buildStatus as CatalystMarketReactionsCache["buildStatus"]) ?? "ok",
    inputRefs: Array.isArray(o.inputRefs)
      ? (o.inputRefs as CatalystMarketReactionsCache["inputRefs"])
      : [],
    reactions,
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystMarketReactionsCache["revisions"])
      : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as CatalystMarketReactionsCache["errors"])
      : [],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
  };
}

export function loadMarketReactionsCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): MarketReactionsCacheLoad {
  const path = marketReactionsLatestPath(
    options.dataRoot ?? DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  );
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Market reactions cache missing at ${path}. Run: npm run catalyst:market-reactions:build`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseMarketReactionsCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const generatedMs = instantMs(cache.generatedAt);
    if (generatedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "market reactions cache: generatedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - generatedMs);
    const staleAfter = options.staleAfterMs ?? MARKET_REACTIONS_STALE_AFTER_MS;
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
