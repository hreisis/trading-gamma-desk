import { describe, expect, it } from "vitest";
import { loadCatalystFeed } from "@/catalyst";
import { PUBLIC_DEMO_BANNER, PUBLIC_DEMO_DISCLAIMER } from "@/desk";

/**
 * Lightweight UI contract checks — render strings the CatalystFeed must show.
 * Full HTML is covered by public-demo production smoke for the macro desk;
 * catalyst banner text is asserted here against the feed model the page passes.
 */
describe("catalyst UI payload", () => {
  it("exposes labels the feed component renders verbatim", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.banner).toBe("Illustrative catalyst demo · synthetic events");
    expect(feed.disclaimer).toMatch(/not actual news/i);
    expect(feed.disclaimer).toMatch(/Consensus unavailable/i);
    const withResult = feed.catalysts.find((c) => c.releaseResult);
    expect(withResult?.releaseResult?.surpriseStatus).toBe("unavailable");
    for (const c of feed.catalysts) {
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
      expect(c.importance.length).toBeGreaterThan(0);
      expect(c.direction.length).toBeGreaterThan(0);
      expect(c.synthetic).toBe(true);
    }
    expect(feed.documents?.length).toBeGreaterThan(0);
    expect(feed.source.documents?.status).toBe("synthetic");
    const withOfficial = feed.catalysts.find(
      (c) => c.officialDocuments && c.officialDocuments.length > 0,
    );
    expect(withOfficial?.officialDocuments?.[0]?.canonicalUrl).toMatch(/^https:/);
    expect(feed.briefs?.length).toBeGreaterThan(0);
    expect(feed.source.briefs?.status).toBe("synthetic");
    expect(feed.disclaimer).toMatch(/rule-based/i);
    expect(feed.aiBriefs?.length).toBeGreaterThan(0);
    expect(feed.source.aiBriefs?.status).toBe("synthetic");
    expect(feed.disclaimer).toMatch(/AI briefs/i);
    for (const ai of feed.aiBriefs ?? []) {
      expect(ai.synthetic).toBe(true);
      expect(ai.bullets.length).toBeGreaterThanOrEqual(2);
    }
    expect(feed.marketContext?.length).toBeGreaterThan(0);
    expect(feed.source.marketContext?.status).toBe("synthetic");
    expect(feed.disclaimer).toMatch(/causation/i);
    expect(feed.marketReactions?.length).toBeGreaterThan(0);
    expect(feed.source.marketReactions?.status).toBe("synthetic");
    for (const r of feed.marketReactions ?? []) {
      expect(r.synthetic).toBe(true);
      expect(r.observations.every((o) => o.ruleId.length > 0)).toBe(true);
    }
    expect(feed.aiMarketReactions?.length).toBeGreaterThan(0);
    expect(feed.source.aiMarketReactions?.status).toBe("synthetic");
    expect(feed.disclaimer).toMatch(/AI market-reaction|Demo AI reaction|observed evidence/i);
    for (const n of feed.aiMarketReactions ?? []) {
      expect(n.synthetic).toBe(true);
      expect(n.bullets?.length).toBeGreaterThanOrEqual(2);
      expect(n.status).toMatch(/complete|partial/);
    }
  });

  it("keeps catalyst demo copy distinct from macro illustrative banner", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.banner).not.toBe(PUBLIC_DEMO_BANNER);
    expect(feed.disclaimer).not.toBe(PUBLIC_DEMO_DISCLAIMER);
  });
});
