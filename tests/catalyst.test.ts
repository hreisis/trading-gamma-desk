import { describe, expect, it } from "vitest";
import {
  CATALYST_DEMO_BANNER,
  CATALYST_DEMO_DISCLAIMER,
  buildCatalystId,
  buildDedupeKey,
  filterCatalysts,
  loadCatalystFeed,
  normalizeAndDedupe,
  normalizeCatalystEvent,
  normalizeDateTime,
  rankImportance,
} from "@/catalyst";
import type { CatalystRawEvent } from "@/catalyst";
import { Catalyst } from "@/contracts";

const base: CatalystRawEvent = {
  synthetic: true,
  externalId: "syn-test-001",
  occurredAt: "2026-07-10T12:00:00Z",
  observedAt: "2026-07-10T12:05:00Z",
  sourceType: "calendar",
  sourceName: "Synthetic Macro Calendar",
  sourceUrl: "https://example.invalid/x",
  headline: "Test FOMC row (illustrative)",
  summary: "Synthetic only",
  rawCategory: "fomc",
  rawStatus: "upcoming",
  rawImportance: "high",
  rawDirection: "unclear",
  affectedAssets: ["US2Y"],
  evidenceStatements: ["synthetic evidence"],
};

describe("catalyst schema + normalization", () => {
  it("normalizes a synthetic FOMC event to a valid Catalyst", () => {
    const result = normalizeCatalystEvent(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = Catalyst.parse(result.catalyst);
    expect(parsed.category).toBe("monetary-policy");
    expect(parsed.status).toBe("upcoming");
    expect(parsed.importance).toBe("high");
    expect(parsed.confidence.calibrated).toBe(false);
    expect(parsed.confidence.note).toMatch(/classification clarity/);
    expect(parsed.synthetic).toBe(true);
    expect(parsed.macroChannels).toContain("fed_rates");
  });

  it("rejects non-synthetic and malformed datetimes", () => {
    expect(
      normalizeCatalystEvent({ ...base, synthetic: false }).ok,
    ).toBe(false);
    expect(
      normalizeCatalystEvent({ ...base, occurredAt: "tomorrow" }).ok,
    ).toBe(false);
    expect(
      normalizeCatalystEvent({ ...base, rawCategory: "not-a-category" }).ok,
    ).toBe(false);
  });

  it("builds stable ids and dedupe keys", () => {
    const key = buildDedupeKey({
      externalId: "Syn-Test-001",
      sourceName: "Synthetic Macro Calendar",
      category: "monetary-policy",
      occurredAt: "2026-07-10T12:00:00Z",
      headline: "ignored when externalId present",
    });
    expect(key).toBe("ext:syn-test-001");
    expect(buildCatalystId(key)).toBe(buildCatalystId(key));
    expect(normalizeDateTime("2026-07-10T12:00:00Z")).toBe(
      "2026-07-10T12:00:00Z",
    );
  });

  it("ranks importance deterministically", () => {
    expect(
      rankImportance({
        category: "other",
        headline: "quiet note",
        status: "released",
      }),
    ).toBe("low");
    expect(
      rankImportance({
        category: "earnings",
        headline: "Emergency halt (illustrative)",
        status: "developing",
        rawImportance: "medium",
      }),
    ).toBe("critical");
  });
});

describe("dedupe and updates", () => {
  it("keeps the newer observation for the same external id", () => {
    const older = { ...base, observedAt: "2026-07-10T12:05:00Z" };
    const newer = {
      ...base,
      observedAt: "2026-07-10T13:00:00Z",
      headline: "Test FOMC row — updated (illustrative)",
      evidenceStatements: ["updated synthetic evidence"],
    };
    const { catalysts, droppedDuplicates, validationErrors } =
      normalizeAndDedupe([older, newer]);
    expect(validationErrors).toHaveLength(0);
    expect(droppedDuplicates).toBe(1);
    expect(catalysts).toHaveLength(1);
    expect(catalysts[0]?.headline).toContain("updated");
    expect(catalysts[0]?.observedAt).toBe("2026-07-10T13:00:00Z");
  });
});

describe("fixture batch + API-shaped feed", () => {
  it("loads synthetic fixtures, drops malformed, updates CPI duplicate", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.mode).toBe("synthetic_demo");
    expect(feed.banner).toBe(CATALYST_DEMO_BANNER);
    expect(feed.disclaimer).toBe(CATALYST_DEMO_DISCLAIMER);
    expect(feed.isPublicDemo).toBe(true);
    expect(feed.validationErrors.length).toBeGreaterThanOrEqual(1);
    expect(
      feed.validationErrors.some((e) => e.externalId === "syn-malformed-001"),
    ).toBe(true);

    const cpi = feed.catalysts.filter((c) => c.category === "inflation");
    expect(cpi).toHaveLength(1);
    expect(cpi[0]?.headline).toMatch(/updated/i);
    expect(cpi[0]?.affectedAssets).toContain("OIL");

    // Expected scenarios present by category/headline markers
    expect(feed.catalysts.some((c) => c.category === "monetary-policy")).toBe(
      true,
    );
    expect(feed.catalysts.some((c) => c.category === "labor")).toBe(true);
    expect(feed.catalysts.some((c) => c.category === "geopolitics")).toBe(true);
    expect(feed.catalysts.some((c) => c.category === "earnings")).toBe(true);
  });

  it("filters deterministically", () => {
    const all = loadCatalystFeed().catalysts;
    const labor = filterCatalysts(all, { category: "labor" });
    expect(labor.length).toBeGreaterThan(0);
    expect(labor.every((c) => c.category === "labor")).toBe(true);

    const oil = filterCatalysts(all, { affectedAsset: "OIL" });
    expect(oil.every((c) => c.affectedAssets.includes("OIL"))).toBe(true);

    const high = filterCatalysts(all, { importance: "high" });
    expect(high.every((c) => c.importance === "high")).toBe(true);
  });

  it("public demo isolation does not invent live mode", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.mode).toBe("synthetic_demo");
    expect(feed.source.synthetic).toBe(true);
    expect(JSON.stringify(feed).toLowerCase()).not.toContain("live news");
  });
});
