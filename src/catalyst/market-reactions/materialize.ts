import type { EventMarketContext, EventMarketReaction } from "@/contracts";

export const MARKET_REACTION_FEED_DAYS = 30;

export function filterMarketReactionsForFeed(
  reactions: readonly EventMarketReaction[],
  marketContexts: readonly EventMarketContext[],
  now: Date = new Date(),
  days: number = MARKET_REACTION_FEED_DAYS,
): EventMarketReaction[] {
  const ctxById = new Map(marketContexts.map((c) => [c.id, c]));
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
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
    return true;
  });
}
