import { describe, expect, it } from "vitest";
import {
  CATALYST_DEMO_BANNER,
  CATALYST_DEMO_DISCLAIMER,
  buildCatalystId,
  buildDedupeKey,
  compareInstant,
  externalIdentityKey,
  filterCatalysts,
  loadCatalystFeed,
  normalizeAndDedupe,
  normalizeCatalystEvent,
  normalizeDateTime,
  normalizeExternalIdentity,
  preferCatalyst,
  rankImportance,
  toUtcIsoZ,
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
    expect(parsed.occurredAt).toBe("2026-07-10T12:00:00.000Z");
  });

  it("rejects unset synthetic and malformed datetimes; accepts official schedule rows", () => {
    expect(
      normalizeCatalystEvent({ ...base, synthetic: undefined }).ok,
    ).toBe(false);
    expect(
      normalizeCatalystEvent({ ...base, occurredAt: "tomorrow" }).ok,
    ).toBe(false);
    expect(
      normalizeCatalystEvent({ ...base, rawCategory: "not-a-category" }).ok,
    ).toBe(false);

    const official = normalizeCatalystEvent({
      ...base,
      synthetic: false,
      externalId: "bls:cpi-test",
      sourceType: "calendar",
      sourceName: "BLS News Release Schedule",
      rawCategory: "inflation",
      rawStatus: "released",
      rawDirection: "inflationary",
      evidenceStatements: ["Official schedule only"],
      evidenceBasis: "official_release_schedule",
    });
    expect(official.ok).toBe(true);
    if (!official.ok) return;
    expect(official.catalyst.synthetic).toBe(false);
    expect(official.catalyst.status).toBe("upcoming");
    expect(official.catalyst.direction).toBe("unclear");
    expect(official.catalyst.evidence[0]?.basis).toBe(
      "official_release_schedule",
    );
  });

  it("builds stable ids and dedupe keys via shared identity helper", () => {
    expect(normalizeExternalIdentity("Syn-Test-001")).toBe("syn-test-001");
    expect(normalizeExternalIdentity(" Syn  Test_001! ")).toBe("syn-test-001");
    expect(externalIdentityKey("Syn-Test-001")).toBe("ext:syn-test-001");

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
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("ranks importance without auto-critical on ordinary surprise", () => {
    expect(
      rankImportance({
        category: "other",
        headline: "quiet note",
        status: "released",
      }),
    ).toBe("low");
    expect(
      rankImportance({
        category: "inflation",
        headline: "CPI print surprise (illustrative)",
        status: "released",
        rawImportance: "high",
      }),
    ).toBe("high");
    expect(
      rankImportance({
        category: "earnings",
        headline: "Emergency halt (illustrative)",
        status: "developing",
        rawImportance: "medium",
      }),
    ).toBe("critical");
    expect(
      rankImportance({
        category: "other",
        headline: "War risk escalation (illustrative)",
        status: "developing",
      }),
    ).toBe("critical");
  });
});

describe("instant time canonicalize + compare", () => {
  it("maps mixed offsets of the same instant to one UTC Z string", () => {
    const a = toUtcIsoZ("2026-07-15T08:30:00-04:00");
    const b = toUtcIsoZ("2026-07-15T12:30:00Z");
    const c = toUtcIsoZ("2026-07-15T05:30:00-07:00");
    expect(a).toBe("2026-07-15T12:30:00.000Z");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(compareInstant(a!, b!)).toBe(0);
  });

  it("orders across offset representations by true time", () => {
    // 2026-07-16T01:00Z vs 2026-07-15T22:00-04:00 (= 2026-07-16T02:00Z)
    const earlier = "2026-07-16T01:00:00Z";
    const laterEt = "2026-07-15T22:00:00-04:00";
    expect(compareInstant(earlier, laterEt)).toBeLessThan(0);
    expect(compareInstant(laterEt, earlier)).toBeGreaterThan(0);
  });

  it("prefers newer observation when offsets differ", () => {
    const older = normalizeCatalystEvent({
      ...base,
      observedAt: "2026-07-10T08:05:00-04:00", // 12:05Z
    });
    const newer = normalizeCatalystEvent({
      ...base,
      observedAt: "2026-07-10T09:00:00-04:00", // 13:00Z
      headline: "Test FOMC row — updated (illustrative)",
    });
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;
    const winner = preferCatalyst(older.catalyst, newer.catalyst);
    expect(winner.observedAt).toBe("2026-07-10T13:00:00.000Z");
    expect(winner.headline).toContain("updated");
  });
});

describe("dedupe and supersession", () => {
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
    expect(catalysts[0]?.observedAt).toBe("2026-07-10T13:00:00.000Z");
  });

  it("supersedes across spaced / cased / punctuated external ids", () => {
    const original: CatalystRawEvent = {
      ...base,
      externalId: "Syn CPI-Surprise 001",
      observedAt: "2026-07-15T08:31:00-04:00",
      headline: "CPI print surprise (illustrative)",
      rawCategory: "cpi",
      rawStatus: "released",
      rawImportance: "high",
    };
    const update: CatalystRawEvent = {
      ...base,
      externalId: "syn_cpi_surprise_001!",
      supersedesExternalId: " SYN cpi.surprise-001 ",
      observedAt: "2026-07-15T09:05:00-04:00",
      headline: "CPI print surprise — updated detail (illustrative)",
      rawCategory: "cpi",
      rawStatus: "released",
      rawImportance: "high",
      affectedAssets: ["US10Y", "GOLD", "USD", "OIL"],
      evidenceStatements: ["superseding synthetic row"],
    };
    expect(normalizeExternalIdentity(original.externalId)).toBe(
      normalizeExternalIdentity(update.supersedesExternalId),
    );
    const { catalysts, droppedDuplicates } = normalizeAndDedupe([
      original,
      update,
    ]);
    expect(droppedDuplicates).toBe(1);
    expect(catalysts).toHaveLength(1);
    expect(catalysts[0]?.headline).toMatch(/updated/i);
    expect(catalysts[0]?.importance).toBe("high");
    expect(catalysts[0]?.affectedAssets).toContain("OIL");
  });

  it("sorts by true occurredAt across mixed offsets", () => {
    const early: CatalystRawEvent = {
      ...base,
      externalId: "syn-sort-a",
      occurredAt: "2026-07-15T20:00:00-04:00", // 2026-07-16T00:00Z
      observedAt: "2026-07-15T20:00:00-04:00",
      headline: "Earlier (illustrative)",
    };
    const late: CatalystRawEvent = {
      ...base,
      externalId: "syn-sort-b",
      occurredAt: "2026-07-16T01:00:00Z",
      observedAt: "2026-07-16T01:00:00Z",
      headline: "Later (illustrative)",
    };
    const { catalysts } = normalizeAndDedupe([early, late]);
    expect(catalysts).toHaveLength(2);
    expect(catalysts[0]?.headline).toContain("Later");
    expect(catalysts[1]?.headline).toContain("Earlier");
  });
});

describe("start/end filter bounds on instants", () => {
  it("includes/excludes at mixed-offset boundaries", () => {
    const batch = normalizeAndDedupe([
      {
        ...base,
        externalId: "syn-bound-in",
        occurredAt: "2026-07-15T08:30:00-04:00", // 12:30Z
        headline: "Inside (illustrative)",
        rawCategory: "cpi",
        rawStatus: "released",
      },
      {
        ...base,
        externalId: "syn-bound-out",
        occurredAt: "2026-07-15T08:29:00-04:00", // 12:29Z
        headline: "Outside (illustrative)",
        rawCategory: "cpi",
        rawStatus: "released",
      },
    ]).catalysts;

    const filtered = filterCatalysts(batch, {
      start: "2026-07-15T12:30:00Z",
      end: "2026-07-15T08:30:00-04:00",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.headline).toContain("Inside");
  });
});

describe("fixture batch + API-shaped feed", () => {
  it("loads synthetic fixtures, drops malformed, updates CPI duplicate as high", () => {
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
    expect(cpi[0]?.importance).toBe("high");
    expect(cpi[0]?.affectedAssets).toContain("OIL");

    expect(feed.catalysts.some((c) => c.category === "monetary-policy")).toBe(
      true,
    );
    expect(feed.catalysts.some((c) => c.category === "labor")).toBe(true);
    expect(feed.catalysts.some((c) => c.category === "geopolitics")).toBe(true);
    expect(feed.catalysts.some((c) => c.category === "earnings")).toBe(true);
  });

  it("filters deterministically", () => {
    const all = loadCatalystFeed({}, { forceSynthetic: true }).catalysts;
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
