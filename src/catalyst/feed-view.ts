import type { CatalystFeed } from "@/contracts";

export type CatalystFeedUiStatus =
  | "loading"
  | "error"
  | "empty"
  | "partial"
  | "ready";

export type MarketReactionUiKind = "available" | "awaiting" | "unavailable";

export interface MarketReactionUiState {
  readonly kind: MarketReactionUiKind;
  readonly message: string;
}

/** Desk-visible feed shell state (SSR: loading only when feed is undefined). */
export function deriveCatalystFeedUiStatus(
  feed: CatalystFeed | null | undefined,
): CatalystFeedUiStatus {
  if (feed === undefined) return "loading";
  if (feed === null || feed.mode === "live_unavailable") return "error";
  if (feed.catalysts.length === 0) return "empty";
  if (feedHasPartialLayers(feed)) return "partial";
  return "ready";
}

export function feedHasPartialLayers(feed: CatalystFeed): boolean {
  if (feed.mode === "stale_calendar") return true;
  if (feed.source.partialFailure) return true;
  if (feed.source.stale) return true;
  const layers = [
    feed.source.results,
    feed.source.documents,
    feed.source.briefs,
    feed.source.aiBriefs,
    feed.source.marketContext,
    feed.source.marketReactions,
    feed.source.aiMarketReactions,
  ];
  return layers.some(
    (layer) =>
      layer &&
      (!layer.available ||
        layer.status === "partial" ||
        layer.status === "missing" ||
        layer.status === "failed" ||
        layer.status === "unavailable"),
  );
}

export function deriveMarketReactionUiState(options: {
  readonly catalystStatus: string;
  readonly hasMarketContext: boolean;
  readonly marketContextStatus?: string;
  readonly hasReaction: boolean;
  readonly feedMarketContextAvailable: boolean;
  readonly feedMarketContextStatus?: string;
  readonly feedMarketReactionsStatus?: string;
}): MarketReactionUiState {
  if (options.hasReaction) {
    return { kind: "available", message: "" };
  }

  const mctxLayerMissing =
    !options.feedMarketContextAvailable ||
    options.feedMarketContextStatus === "missing";

  if (mctxLayerMissing) {
    return { kind: "awaiting", message: "Awaiting market data" };
  }

  if (
    options.feedMarketContextStatus === "unavailable" ||
    options.feedMarketContextStatus === "failed" ||
    options.feedMarketReactionsStatus === "failed" ||
    options.feedMarketReactionsStatus === "unavailable"
  ) {
    return { kind: "unavailable", message: "Market reaction unavailable" };
  }

  if (
    options.hasMarketContext &&
    options.marketContextStatus === "unavailable"
  ) {
    return { kind: "unavailable", message: "Market reaction unavailable" };
  }

  if (options.catalystStatus === "upcoming") {
    return { kind: "awaiting", message: "Awaiting market data" };
  }

  if (options.hasMarketContext && !options.hasReaction) {
    if (options.feedMarketReactionsStatus === "partial") {
      return { kind: "unavailable", message: "Market reaction unavailable" };
    }
    return { kind: "awaiting", message: "Awaiting market data" };
  }

  if (!options.hasMarketContext) {
    if (
      options.catalystStatus === "released" ||
      options.catalystStatus === "developing"
    ) {
      return mctxLayerMissing
        ? { kind: "awaiting", message: "Awaiting market data" }
        : { kind: "unavailable", message: "Market reaction unavailable" };
    }
    return { kind: "awaiting", message: "Awaiting market data" };
  }

  return { kind: "unavailable", message: "Market reaction unavailable" };
}

export function formatCategoryLabel(category: string): string {
  return category.replace(/-/g, " ");
}

export function formatReleaseStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function formatImportanceLabel(importance: string): string {
  if (!importance) return importance;
  return importance.charAt(0).toUpperCase() + importance.slice(1);
}

export function formatDirectionLabel(direction: string): string {
  return direction.replace(/-/g, " ");
}

export function formatEquityBreadthLabel(breadth: string): string {
  return breadth.replace(/_/g, " ");
}

export function formatLeadershipLabel(status: string): string {
  switch (status) {
    case "nasdaq_proxy_leads":
      return "Nasdaq proxy leads";
    case "small_cap_proxy_leads":
      return "Small-cap proxy leads";
    case "no_clear_leader":
      return "No clear leader";
    case "mixed":
      return "Mixed leadership";
    case "unavailable":
      return "Leadership unavailable";
    default:
      return status.replace(/_/g, " ");
  }
}

export function providerLabel(provider: string): string {
  if (provider === "federal_reserve") return "Federal Reserve";
  if (provider === "bls") return "BLS";
  if (provider === "bea") return "BEA";
  return provider;
}
