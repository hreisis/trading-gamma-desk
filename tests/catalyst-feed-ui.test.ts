import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalystFeed } from "@/app/components/catalyst-feed/CatalystFeed";
import {
  deriveCatalystFeedUiStatus,
  deriveMarketReactionUiState,
  feedHasPartialLayers,
} from "@/catalyst/feed-view";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { CatalystFeed as CatalystFeedSchema } from "@/contracts";

function renderFeed(
  feed: Parameters<typeof CatalystFeed>[0]["feed"],
): string {
  return renderToStaticMarkup(createElement(CatalystFeed, { feed }));
}

describe("catalyst feed UI status", () => {
  it("derives loading, empty, partial, and ready from public feed", () => {
    expect(deriveCatalystFeedUiStatus(undefined)).toBe("loading");

    const demo = toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));
    expect(deriveCatalystFeedUiStatus(demo)).toBe("ready");
    expect(demo.catalysts.length).toBeGreaterThan(0);

    const empty: typeof demo = { ...demo, catalysts: [], count: 0 };
    expect(deriveCatalystFeedUiStatus(empty)).toBe("empty");

    const partial: typeof demo = {
      ...demo,
      mode: "stale_calendar",
      source: { ...demo.source, stale: true },
    };
    expect(feedHasPartialLayers(partial)).toBe(true);
    expect(deriveCatalystFeedUiStatus(partial)).toBe("partial");
  });

  it("maps market reaction layers to awaiting vs unavailable", () => {
    expect(
      deriveMarketReactionUiState({
        catalystStatus: "upcoming",
        hasMarketContext: false,
        hasReaction: false,
        feedMarketContextAvailable: false,
      }).message,
    ).toBe("Awaiting market data");

    expect(
      deriveMarketReactionUiState({
        catalystStatus: "released",
        hasMarketContext: false,
        hasReaction: false,
        feedMarketContextAvailable: true,
        feedMarketContextStatus: "unavailable",
      }).kind,
    ).toBe("unavailable");

    expect(
      deriveMarketReactionUiState({
        catalystStatus: "released",
        hasMarketContext: true,
        marketContextStatus: "complete",
        hasReaction: true,
        feedMarketContextAvailable: true,
      }).kind,
    ).toBe("available");
  });
});

describe("catalyst feed SSR markup", () => {
  it("renders event cards with brief and market reaction sections in demo", () => {
    const feed = toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));
    const html = renderFeed(feed);

    expect(html).toContain("Catalyst feed");
    expect(html).toContain(feed.banner);
    expect(html).toContain('data-testid="catalyst-list"');
    expect(html).toContain('data-testid="catalyst-event-card"');
    expect(html).toContain('data-testid="catalyst-official-brief"');
    expect(html).toContain('data-testid="catalyst-market-reaction-panel"');
    expect(html).toContain('data-testid="catalyst-market-reaction"');
    expect(html).toContain('data-testid="catalyst-ai-brief-evidence"');
    expect(html).not.toMatch(/officialFactsIdentity/);
    expect(html).not.toMatch(/data\/catalyst\//);
  });

  it("shows loading skeleton when feed is undefined", () => {
    const html = renderFeed(undefined);
    expect(html).toContain('data-testid="catalyst-loading"');
  });

  it("shows empty state without fabricating events", () => {
    const base = toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));
    const empty = { ...base, catalysts: [], count: 0 };
    const html = renderFeed(empty);
    expect(html).toContain('data-testid="catalyst-empty"');
    expect(html).not.toContain('data-testid="catalyst-event-card"');
  });

  it("shows awaiting market data when reaction layer is missing", () => {
    const base = toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));
    const noMrxn: typeof base = {
      ...base,
      marketReactions: [],
      aiMarketReactions: [],
      source: {
        ...base.source,
        marketContext: {
          available: false,
          status: "missing",
        },
        marketReactions: {
          available: false,
          status: "missing",
        },
        aiMarketReactions: {
          available: false,
          status: "missing",
        },
      },
    };
    const html = renderFeed(noMrxn);
    expect(html).toContain("Awaiting market data");
    expect(html).not.toContain('data-testid="catalyst-mrxn-core"');
    expect(html).not.toMatch(/\+0\.00%/);
  });

  it("validates API-shaped feed before render", () => {
    const pub = toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));
    expect(CatalystFeedSchema.safeParse(pub).success).toBe(true);
    const html = renderFeed(pub);
    expect(html).toContain('data-testid="catalyst-feed-source"');
  });
});
