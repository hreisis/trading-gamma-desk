import type { EventMarketContext } from "@/contracts";
import type { Catalyst } from "@/contracts";
import { MARKET_CONTEXT_FEED_DAYS } from "./config";

export function filterMarketContextForFeed(
  snapshots: readonly EventMarketContext[],
  catalysts: readonly Catalyst[],
  now: Date = new Date(),
  days: number = MARKET_CONTEXT_FEED_DAYS,
): EventMarketContext[] {
  const byId = new Map(catalysts.map((c) => [c.id, c]));
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return snapshots.filter((s) => {
    if (s.status === "unavailable") return false;
    const c = byId.get(s.catalystId);
    if (!c) return false;
    const eventMs = Date.parse(s.eventTimestamp);
    if (!Number.isFinite(eventMs)) return false;
    if (eventMs < start || eventMs > now.getTime()) return false;
    // Stale identity: event time must still match the catalyst.
    if (new Date(Date.parse(c.occurredAt)).toISOString() !== s.eventTimestamp) {
      return false;
    }
    return true;
  });
}

export function isEligibleReleasedCatalyst(
  catalyst: Catalyst,
  now: Date,
  days: number = MARKET_CONTEXT_FEED_DAYS,
): boolean {
  if (catalyst.status !== "released") return false;
  const eventMs = Date.parse(catalyst.occurredAt);
  if (!Number.isFinite(eventMs)) return false;
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  return eventMs >= start && eventMs <= now.getTime();
}
