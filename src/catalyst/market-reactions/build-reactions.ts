import { writeJsonAtomic } from "@/desk/atomic-write";
import { isPublicDemoMode } from "@/desk/public-demo";
import type { EventMarketContext, EventMarketReaction } from "@/contracts";
import { loadMarketContextCache } from "../market-context/cache";
import { MARKET_CONTEXT_FEED_DAYS } from "../market-context/config";
import { classifyMarketReaction, marketContextIdentity } from "./classify";
import { loadMarketReactionsCache } from "./cache";
import { MARKET_REACTION_FEED_DAYS } from "./materialize";
import {
  DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  marketReactionsLatestPath,
} from "./paths";
import type {
  CatalystMarketReactionsCache,
  MarketReactionBuildError,
  MarketReactionInputRef,
  MarketReactionRevisionRecord,
} from "./types";
import { REACTION_RULES_VERSION } from "./version";

export {
  DEFAULT_MARKET_REACTIONS_DATA_ROOT,
  MARKET_REACTIONS_LATEST_RELATIVE,
  marketReactionsLatestPath,
} from "./paths";

export interface BuildMarketReactionsOptions {
  readonly now?: Date;
  readonly dataRoot?: string;
  readonly marketContextDataRoot?: string;
  readonly publicDemo?: boolean;
  readonly write?: boolean;
  readonly force?: boolean;
  /** Test injection. */
  readonly snapshots?: readonly EventMarketContext[];
  readonly maxPerRun?: number;
}

export interface BuildMarketReactionsResult {
  readonly cache: CatalystMarketReactionsCache;
  readonly path: string | null;
}

function isEligibleSnapshot(
  snap: EventMarketContext,
  now: Date,
  days: number,
): boolean {
  if (snap.status === "unavailable") return false;
  const eventMs = Date.parse(snap.eventTimestamp);
  if (!Number.isFinite(eventMs)) return false;
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return eventMs >= start && eventMs <= now.getTime();
}

/**
 * Build deterministic market reactions from local M2-4A cache only.
 * Never fetches Alpaca or other catalyst workflows.
 */
export function buildMarketReactions(
  options: BuildMarketReactionsOptions = {},
): BuildMarketReactionsResult {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  if (publicDemo) {
    throw new Error(
      "Market reactions build is disabled in public demo (GAMMADESK_PUBLIC_DEMO). " +
        "Public demo derives reactions from synthetic market-context fixtures.",
    );
  }

  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const dataRoot = options.dataRoot ?? DEFAULT_MARKET_REACTIONS_DATA_ROOT;
  const mctxRoot = options.marketContextDataRoot ?? dataRoot;
  const maxPerRun = options.maxPerRun ?? 50;

  let snapshots: EventMarketContext[];
  if (options.snapshots) {
    snapshots = [...options.snapshots];
  } else {
    const loaded = loadMarketContextCache({ dataRoot: mctxRoot, now });
    if (!loaded.ok) {
      throw new Error(
        `Cannot build market reactions: ${loaded.reason}: ${loaded.error}`,
      );
    }
    snapshots = loaded.cache.snapshots;
  }

  const eligible = snapshots
    .filter((s) =>
      isEligibleSnapshot(s, now, MARKET_CONTEXT_FEED_DAYS),
    )
    .slice(0, maxPerRun);

  const prior = loadMarketReactionsCache({ dataRoot, now });
  const priorByCatalyst = new Map<string, EventMarketReaction>();
  if (prior.ok) {
    for (const r of prior.cache.reactions) {
      priorByCatalyst.set(r.catalystId, r);
    }
  }

  const outReactions: EventMarketReaction[] = prior.ok
    ? [
        ...prior.cache.reactions.filter(
          (r) => !eligible.some((e) => e.catalystId === r.catalystId),
        ),
      ]
    : [];
  const inputRefs: MarketReactionInputRef[] = prior.ok
    ? [...prior.cache.inputRefs]
    : [];
  const revisions: MarketReactionRevisionRecord[] = prior.ok
    ? [...prior.cache.revisions]
    : [];
  const errors: MarketReactionBuildError[] = [];
  const warnings: string[] = [];

  let successCount = 0;
  let failCount = 0;

  for (const snap of eligible) {
    const identity = marketContextIdentity(snap);
    const previous = priorByCatalyst.get(snap.catalystId);
    if (
      !options.force &&
      previous &&
      previous.marketContextIdentity === identity &&
      previous.reactionRulesVersion === REACTION_RULES_VERSION &&
      previous.marketContextId === snap.id &&
      (previous.status === "complete" || previous.status === "partial")
    ) {
      outReactions.push(previous);
      successCount += 1;
      continue;
    }

    try {
      const reaction = classifyMarketReaction(snap, { generatedAt });
      outReactions.push(reaction);
      inputRefs.push({
        catalystId: snap.catalystId,
        marketContextId: snap.id,
        marketContextIdentity: identity,
        reactionRulesVersion: REACTION_RULES_VERSION,
        marketContextCalculationVersion: snap.calculationVersion,
      });
      if (previous && previous.id !== reaction.id) {
        revisions.push({
          catalystId: snap.catalystId,
          previousId: previous.id,
          currentId: reaction.id,
          observedAt: generatedAt,
          reason: options.force
            ? "force rebuild"
            : previous.reactionRulesVersion !== REACTION_RULES_VERSION
              ? "rules version changed"
              : "market context identity changed",
        });
      }
      if (reaction.status === "insufficient") {
        failCount += 1;
        errors.push({
          catalystId: snap.catalystId,
          error: "insufficient source coverage",
          status: reaction.status,
        });
      } else {
        successCount += 1;
      }
    } catch (error: unknown) {
      failCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ catalystId: snap.catalystId, error: message });
      // Keep prior good reaction for this catalyst if present.
      if (previous) outReactions.push(previous);
    }
  }

  const byCatalyst = new Map<string, EventMarketReaction>();
  for (const r of outReactions) byCatalyst.set(r.catalystId, r);
  const deduped = [...byCatalyst.values()];

  const allFailed = eligible.length > 0 && successCount === 0;
  const buildStatus: CatalystMarketReactionsCache["buildStatus"] =
    eligible.length === 0
      ? prior.ok
        ? prior.cache.buildStatus
        : "ok"
      : allFailed
        ? "failed"
        : failCount > 0
          ? "partial"
          : "ok";

  // Dedupe input refs
  const refMap = new Map<string, MarketReactionInputRef>();
  for (const r of inputRefs) refMap.set(r.catalystId, r);

  const cache: CatalystMarketReactionsCache = {
    kind: "CatalystMarketReactionsCache",
    schemaVersion: "0.1.0",
    generatedAt,
    reactionRulesVersion: REACTION_RULES_VERSION,
    buildStatus,
    inputRefs: [...refMap.values()],
    reactions: deduped,
    revisions: revisions.slice(-100),
    errors,
    warnings,
  };

  // Do not wipe a prior good cache when every classification fails hard.
  const shouldWrite =
    options.write !== false &&
    !(allFailed && prior.ok && prior.cache.reactions.length > 0 && failCount === eligible.length && successCount === 0);

  // Actually: if we had successes, write. If all failed but we still produced
  // insufficient reactions, write those. Only skip write when we threw on all
  // and kept only prior via exception path with allFailed from zero success
  // AND we didn't add any new reactions — the shouldWrite above is fine.
  // Simpler: always write unless input cache missing (already threw) or
  // public demo. User asked: input missing/corrupt → fail clearly.
  // Provider-wide N/A. Always write when we have a computed cache unless
  // allFailed with prior and no new successful classifications.
  let path: string | null = null;
  if (options.write !== false) {
    if (
      allFailed &&
      prior.ok &&
      prior.cache.reactions.some(
        (r) => r.status === "complete" || r.status === "partial",
      ) &&
      successCount === 0 &&
      errors.every((e) => e.error !== "insufficient source coverage")
    ) {
      warnings.push(
        "Build produced no usable reactions — prior market-reactions cache left untouched.",
      );
    } else {
      path = marketReactionsLatestPath(dataRoot);
      writeJsonAtomic(path, cache);
    }
  }

  return { cache, path };
}

export { MARKET_REACTION_FEED_DAYS };
