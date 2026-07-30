import { existsSync, readFileSync } from "node:fs";
import { EventMarketContext } from "@/contracts";
import { instantMs } from "../time";
import {
  DEFAULT_MARKET_CONTEXT_DATA_ROOT,
  marketContextLatestPath,
} from "./paths";
import type { CatalystMarketContextCache } from "./types";

export const MARKET_CONTEXT_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export type MarketContextCacheLoad =
  | {
      readonly ok: true;
      readonly cache: CatalystMarketContextCache;
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

export function parseMarketContextCache(
  raw: unknown,
): CatalystMarketContextCache {
  if (!raw || typeof raw !== "object") {
    throw new Error("market context cache: root must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "CatalystMarketContextCache") {
    throw new Error(
      "market context cache: kind must be CatalystMarketContextCache",
    );
  }
  if (o.schemaVersion !== "0.1.0") {
    throw new Error(
      `market context cache: unsupported schemaVersion ${String(o.schemaVersion)}`,
    );
  }
  if (typeof o.fetchedAt !== "string" || instantMs(o.fetchedAt) === null) {
    throw new Error("market context cache: fetchedAt missing or invalid");
  }
  if (!Array.isArray(o.snapshots)) {
    throw new Error("market context cache: snapshots must be an array");
  }
  const snapshots = o.snapshots.map((s, i) => {
    const parsed = EventMarketContext.safeParse(s);
    if (!parsed.success) {
      throw new Error(
        `market context cache: snapshots[${i}] invalid: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    return parsed.data;
  });

  return {
    kind: "CatalystMarketContextCache",
    schemaVersion: "0.1.0",
    fetchedAt: o.fetchedAt,
    provider: String(o.provider ?? "unknown"),
    feed: String(o.feed ?? "unknown"),
    calculationVersion: String(o.calculationVersion ?? ""),
    buildStatus:
      (o.buildStatus as CatalystMarketContextCache["buildStatus"]) ?? "ok",
    inputRefs: Array.isArray(o.inputRefs)
      ? (o.inputRefs as CatalystMarketContextCache["inputRefs"])
      : [],
    snapshots,
    revisions: Array.isArray(o.revisions)
      ? (o.revisions as CatalystMarketContextCache["revisions"])
      : [],
    errors: Array.isArray(o.errors)
      ? (o.errors as CatalystMarketContextCache["errors"])
      : [],
    warnings: Array.isArray(o.warnings) ? (o.warnings as string[]) : [],
  };
}

export function loadMarketContextCache(options: {
  readonly dataRoot?: string;
  readonly now?: Date;
  readonly staleAfterMs?: number;
} = {}): MarketContextCacheLoad {
  const path = marketContextLatestPath(
    options.dataRoot ?? DEFAULT_MARKET_CONTEXT_DATA_ROOT,
  );
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      error: `Market context cache missing at ${path}. Run: npm run catalyst:market-context:fetch`,
      path,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const cache = parseMarketContextCache(raw);
    const nowMs = (options.now ?? new Date()).getTime();
    const fetchedMs = instantMs(cache.fetchedAt);
    if (fetchedMs === null) {
      return {
        ok: false,
        reason: "malformed",
        error: "market context cache: fetchedAt not parseable",
        path,
      };
    }
    const ageMs = Math.max(0, nowMs - fetchedMs);
    const staleAfter = options.staleAfterMs ?? MARKET_CONTEXT_STALE_AFTER_MS;
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
