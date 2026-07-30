import { describe, expect, it } from "vitest";
import {
  loadCatalystFeed,
  toPublicCatalystFeed,
} from "@/catalyst";
import { CatalystFeed } from "@/contracts";

describe("M3-0.5 public CatalystFeed DTO", () => {
  it("validates Zod contract and strips internal fields", () => {
    const internal = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T20:00:00.000Z") },
    );
    const pub = toPublicCatalystFeed(internal);
    expect(CatalystFeed.safeParse(pub).success).toBe(true);

    expect(pub.source.name).toBe("synthetic_fixtures");
    expect(pub.source.name).not.toMatch(/data\//);
    expect(JSON.stringify(pub)).not.toMatch(/data\/catalyst\//);
    expect(JSON.stringify(pub)).not.toMatch(/usage/);
    expect(JSON.stringify(pub)).not.toMatch(/officialFactsIdentity/);
    expect(JSON.stringify(pub)).not.toMatch(/marketReactionIdentity/);
    expect(JSON.stringify(pub)).not.toMatch(/inputTokens|outputTokens|totalTokens/);

    for (const layer of [
      pub.source.results,
      pub.source.documents,
      pub.source.briefs,
      pub.source.aiBriefs,
      pub.source.marketContext,
      pub.source.marketReactions,
      pub.source.aiMarketReactions,
    ]) {
      if (layer) {
        expect("error" in layer).toBe(false);
      }
    }

    expect(pub.validationIssueCount).toBe(internal.validationErrors.length);
    expect(pub.source.marketContext?.status).toBe("synthetic");
    expect(pub.source.marketReactions?.status).toBe("synthetic");
    expect(pub.marketReactions?.length).toBeGreaterThan(0);
    expect(pub.aiMarketReactions?.length).toBeGreaterThan(0);
  });

  it("keeps UI status/count fields", () => {
    const pub = toPublicCatalystFeed(
      loadCatalystFeed({}, { publicDemo: true }),
    );
    expect(pub.mode).toBe("synthetic_demo");
    expect(pub.banner.length).toBeGreaterThan(0);
    expect(pub.count).toBe(pub.catalysts.length);
    expect(typeof pub.source.briefs?.available).toBe("boolean");
    expect(typeof pub.source.marketContext?.available).toBe("boolean");
  });
});
