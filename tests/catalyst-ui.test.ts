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
    for (const c of feed.catalysts) {
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
      expect(c.importance.length).toBeGreaterThan(0);
      expect(c.direction.length).toBeGreaterThan(0);
      expect(c.synthetic).toBe(true);
    }
  });

  it("keeps catalyst demo copy distinct from macro illustrative banner", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.banner).not.toBe(PUBLIC_DEMO_BANNER);
    expect(feed.disclaimer).not.toBe(PUBLIC_DEMO_DISCLAIMER);
  });
});
