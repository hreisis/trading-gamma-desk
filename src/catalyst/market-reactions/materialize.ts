import type { EventMarketContext, EventMarketReaction } from "@/contracts";

export const MARKET_REACTION_FEED_DAYS = 30;

export interface FilterMarketReactionsForFeedOptions {
  /**
   * Current official event/facts identity by catalystId.
   * Reactions whose stored `officialFactsIdentity` does not match are dropped.
   */
  readonly officialFactsIdentityByCatalystId: ReadonlyMap<string, string>;
}

/**
 * Feed filter for M2-4B. Requires identity-consistent market context and
 * current official facts identity — stale reactions after facts change are dropped.
 */
export function filterMarketReactionsForFeed(
  reactions: readonly EventMarketReaction[],
  marketContexts: readonly EventMarketContext[],
  now: Date = new Date(),
  days: number = MARKET_REACTION_FEED_DAYS,
  options: FilterMarketReactionsForFeedOptions,
): EventMarketReaction[] {
  const ctxById = new Map(marketContexts.map((c) => [c.id, c]));
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  const factsByCatalyst = options.officialFactsIdentityByCatalystId;

  return reactions.filter((r) => {
    if (r.status === "insufficient") return false;
    const ctx = ctxById.get(r.marketContextId);
    if (!ctx) return false;
    const eventMs = Date.parse(r.eventTimestamp);
    if (!Number.isFinite(eventMs)) return false;
    if (eventMs < start || eventMs > now.getTime()) return false;
    // Stale identity vs current market context.
    if (r.marketContextId !== ctx.id) return false;
    if (r.eventTimestamp !== ctx.eventTimestamp) return false;
    // Stale vs current official event/facts identity.
    const currentFacts = factsByCatalyst.get(r.catalystId);
    if (!currentFacts) return false;
    if (r.officialFactsIdentity !== currentFacts) return false;
    return true;
  });
}
