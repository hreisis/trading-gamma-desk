import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyStructuredCrossCheck,
  BRIEF_EXTRACTOR_VERSION,
  buildOfficialBriefs,
  briefsLatestPath,
  evidenceResolves,
  extractBriefFromDocument,
  filterBriefsForFeed,
  indexStructuredReleases,
  loadBriefsCache,
  loadCatalystFeed,
  parsePercentToken,
  parseSignedNumber,
  publishedAtMapFromDocuments,
} from "@/catalyst";
import type { OfficialDocument, ReleaseResult } from "@/contracts";
import { documentContentHash } from "@/catalyst/documents/hash";
import {
  CPI_BODY,
  EMPLOYMENT_BODY,
  FOMC_CUT,
  FOMC_MAINTAIN,
  FOMC_RAISE,
  GDP_BODY,
  PIO_BODY,
  TRADE_BODY,
} from "../fixtures/catalyst/briefs/sample-bodies";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m23b-"));
}

function makeDoc(
  partial: Omit<OfficialDocument, "schemaVersion" | "contentHash"> & {
    contentHash?: string;
  },
): OfficialDocument {
  const contentHash =
    partial.contentHash ??
    documentContentHash({
      title: partial.title,
      contentText: partial.contentText,
      summaryFromSource: partial.summaryFromSource,
    });
  return {
    schemaVersion: "0.1.0",
    ...partial,
    contentHash,
  };
}

describe("numeric safety", () => {
  it("parses negatives, commas, parentheses, unchanged", () => {
    expect(parseSignedNumber("1,234")).toBe(1234);
    expect(parseSignedNumber("(22)")).toBe(-22);
    expect(parseSignedNumber("-0.3")).toBe(-0.3);
    expect(parsePercentToken("unchanged")).toBe(0);
    expect(parsePercentToken("0.1")).toBe(0.1);
  });
});

describe("per-document extractors", () => {
  it("FOMC maintain / raise / cut with range, vote, dissent", () => {
    const maintain = extractBriefFromDocument(
      makeDoc({
        id: "odoc_fomc_m",
        provider: "federal_reserve",
        sourceName: "Fed",
        canonicalUrl:
          "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
        title: "Federal Reserve issues FOMC statement",
        publishedAt: "2026-07-29T18:00:00.000Z",
        observedAt: "2026-07-29T18:05:00.000Z",
        documentType: "fomc_statement",
        releaseFamily: "fomc_policy",
        contentText: FOMC_MAINTAIN,
        synthetic: false,
      }),
      "2026-07-29T19:00:00.000Z",
    );
    expect(maintain.status).toBe("partial");
    expect(maintain.facts.some((f) => f.factType === "policy_action")).toBe(
      true,
    );
    expect(
      maintain.facts.some((f) =>
        f.values?.some((v) => v.metric === "fomc_target_range_low" && v.value === 4.25),
      ),
    ).toBe(true);
    expect(maintain.facts.some((f) => f.id.endsWith("vote_result"))).toBe(true);
    expect(maintain.facts.some((f) => f.id.endsWith("dissenters"))).toBe(true);
    expect(maintain.headline).not.toMatch(/hawkish|dovish/i);

    const raise = extractBriefFromDocument(
      makeDoc({
        id: "odoc_fomc_r",
        provider: "federal_reserve",
        sourceName: "Fed",
        canonicalUrl:
          "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260101a.htm",
        title: "Federal Reserve issues FOMC statement",
        publishedAt: "2026-01-01T18:00:00.000Z",
        observedAt: "2026-01-01T18:05:00.000Z",
        documentType: "fomc_statement",
        releaseFamily: "fomc_policy",
        contentText: FOMC_RAISE,
        synthetic: false,
      }),
      "2026-01-01T19:00:00.000Z",
    );
    expect(raise.headline).toMatch(/Raised/i);

    const cut = extractBriefFromDocument(
      makeDoc({
        id: "odoc_fomc_c",
        provider: "federal_reserve",
        sourceName: "Fed",
        canonicalUrl:
          "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260201a.htm",
        title: "Federal Reserve issues FOMC statement",
        publishedAt: "2026-02-01T18:00:00.000Z",
        observedAt: "2026-02-01T18:05:00.000Z",
        documentType: "fomc_statement",
        releaseFamily: "fomc_policy",
        contentText: FOMC_CUT,
        synthetic: false,
      }),
      "2026-02-01T19:00:00.000Z",
    );
    expect(cut.headline).toMatch(/Lowered/i);
  });

  it("CPI monthly vs 12-month and headline vs core with SA note", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_cpi",
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
        title: "Consumer Price Index — June 2026",
        publishedAt: "2026-07-15T12:30:00.000Z",
        observedAt: "2026-07-15T12:35:00.000Z",
        documentType: "cpi_release",
        releaseFamily: "cpi",
        referencePeriod: "2026-06",
        contentText: CPI_BODY,
        synthetic: false,
      }),
      "2026-07-15T13:00:00.000Z",
    );
    expect(brief.status).toBe("complete");
    const metrics = new Set(
      brief.facts.flatMap((f) => (f.values ?? []).map((v) => v.metric)),
    );
    expect(metrics.has("headline_cpi_sa_mom")).toBe(true);
    expect(metrics.has("headline_cpi_sa_yoy")).toBe(true);
    expect(metrics.has("core_cpi_sa_mom")).toBe(true);
    expect(metrics.has("core_cpi_sa_yoy")).toBe(true);
    const mom = brief.facts.find((f) =>
      f.values?.some((v) => v.metric === "headline_cpi_sa_mom"),
    );
    expect(mom?.text).toMatch(/seasonally adjusted/i);
  });

  it("Employment payrolls, unemployment, revision, reference month", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_emp",
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: "https://www.bls.gov/news.release/empsit.nr0.htm",
        title: "The Employment Situation — June 2026",
        publishedAt: "2026-07-03T12:30:00.000Z",
        observedAt: "2026-07-03T12:35:00.000Z",
        documentType: "employment_release",
        releaseFamily: "employment_situation",
        referencePeriod: "2026-06",
        contentText: EMPLOYMENT_BODY,
        synthetic: false,
      }),
      "2026-07-03T13:00:00.000Z",
    );
    expect(
      brief.facts.some((f) =>
        f.values?.some(
          (v) => v.metric === "total_nonfarm_payrolls_mom" && v.value === 147,
        ),
      ),
    ).toBe(true);
    expect(
      brief.facts.some((f) =>
        f.values?.some((v) => v.metric === "unemployment_rate" && v.value === 4.1),
      ),
    ).toBe(true);
    expect(brief.facts.some((f) => f.factType === "revision")).toBe(true);
    expect(brief.facts.some((f) => f.id.endsWith("reference_month"))).toBe(true);
  });

  it("GDP annualized + estimate type + previous estimate", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_gdp",
        provider: "bea",
        sourceName: "BEA",
        canonicalUrl:
          "https://www.bea.gov/news/2026/gross-domestic-product-1st-quarter-2026-third-estimate",
        title: "Gross Domestic Product, 1st Quarter 2026 (Third Estimate)",
        publishedAt: "2026-06-25T12:30:00.000Z",
        observedAt: "2026-06-25T12:40:00.000Z",
        documentType: "gdp_release",
        releaseFamily: "gdp",
        referencePeriod: "2026-Q1",
        contentText: GDP_BODY,
        synthetic: false,
      }),
      "2026-06-25T13:00:00.000Z",
    );
    expect(
      brief.facts.some((f) =>
        f.values?.some((v) => v.metric === "real_gdp_annualized" && v.value === 2.1),
      ),
    ).toBe(true);
    expect(brief.facts.some((f) => f.id.endsWith("estimate_type"))).toBe(true);
    expect(brief.facts.some((f) => f.factType === "comparison")).toBe(true);
  });

  it("Personal income / PCE facts", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_pio",
        provider: "bea",
        sourceName: "BEA",
        canonicalUrl:
          "https://www.bea.gov/news/2026/personal-income-and-outlays-may-2026",
        title: "Personal Income and Outlays, May 2026",
        publishedAt: "2026-06-25T12:30:00.000Z",
        observedAt: "2026-06-25T12:40:00.000Z",
        documentType: "personal_income_outlays_release",
        releaseFamily: "personal_income_outlays",
        referencePeriod: "2026-05",
        contentText: PIO_BODY,
        synthetic: false,
      }),
      "2026-06-25T13:00:00.000Z",
    );
    const metrics = new Set(
      brief.facts.flatMap((f) => (f.values ?? []).map((v) => v.metric)),
    );
    expect(metrics.has("personal_income_mom")).toBe(true);
    expect(metrics.has("disposable_personal_income_mom")).toBe(true);
    expect(metrics.has("pce_spending_mom")).toBe(true);
    expect(metrics.has("core_pce_yoy")).toBe(true);
  });

  it("Trade deficit, exports, imports, change", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_trade",
        provider: "bea",
        sourceName: "BEA",
        canonicalUrl:
          "https://www.bea.gov/news/2026/us-international-trade-goods-and-services-may-2026",
        title: "U.S. International Trade in Goods and Services, May 2026",
        publishedAt: "2026-07-07T12:30:00.000Z",
        observedAt: "2026-07-07T12:40:00.000Z",
        documentType: "international_trade_release",
        releaseFamily: "international_trade",
        referencePeriod: "2026-05",
        contentText: TRADE_BODY,
        synthetic: false,
      }),
      "2026-07-07T13:00:00.000Z",
    );
    const bal = brief.facts.find((f) =>
      f.values?.some((v) => v.metric === "trade_balance"),
    );
    expect(bal?.values?.[0]?.value).toBe(-77.6);
    expect(
      brief.facts.some((f) => f.values?.some((v) => v.metric === "exports")),
    ).toBe(true);
    expect(
      brief.facts.some((f) => f.values?.some((v) => v.metric === "imports")),
    ).toBe(true);
  });
});

describe("evidence integrity", () => {
  it("every fact excerpt is an exact substring with valid offsets", () => {
    const doc = makeDoc({
      id: "odoc_cpi_ev",
      provider: "bls",
      sourceName: "BLS",
      canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      title: "Consumer Price Index — June 2026",
      publishedAt: "2026-07-15T12:30:00.000Z",
      observedAt: "2026-07-15T12:35:00.000Z",
      documentType: "cpi_release",
      releaseFamily: "cpi",
      referencePeriod: "2026-06",
      contentText: CPI_BODY,
      synthetic: false,
    });
    const brief = extractBriefFromDocument(doc, "2026-07-15T13:00:00.000Z");
    for (const f of brief.facts) {
      expect(f.evidence.contentHash).toBe(doc.contentHash);
      expect(evidenceResolves(doc.contentText!, f.evidence)).toBe(true);
    }
  });

  it("unsupported facts become omissions without unsupported prose", () => {
    const brief = extractBriefFromDocument(
      makeDoc({
        id: "odoc_thin",
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
        title: "Consumer Price Index — June 2026",
        publishedAt: "2026-07-15T12:30:00.000Z",
        observedAt: "2026-07-15T12:35:00.000Z",
        documentType: "cpi_release",
        releaseFamily: "cpi",
        referencePeriod: "2026-06",
        contentText: "THE CONSUMER PRICE INDEX -- JUNE 2026 No printable numbers.",
        synthetic: false,
      }),
      "2026-07-15T13:00:00.000Z",
    );
    expect(brief.facts).toHaveLength(0);
    expect(brief.status).toBe("unavailable");
    expect(brief.omissions.length).toBeGreaterThan(0);
    expect(brief.headline).not.toMatch(/therefore|implies|market/i);
  });
});

describe("structured cross-check", () => {
  it("matches within tolerance and warns on mismatch without overwrite", () => {
    const doc = makeDoc({
      id: "odoc_cpi_x",
      provider: "bls",
      sourceName: "BLS",
      canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      title: "Consumer Price Index — June 2026",
      publishedAt: "2026-07-15T12:30:00.000Z",
      observedAt: "2026-07-15T12:35:00.000Z",
      documentType: "cpi_release",
      releaseFamily: "cpi",
      referencePeriod: "2026-06",
      contentText: CPI_BODY,
      synthetic: false,
    });
    const brief = extractBriefFromDocument(doc, "2026-07-15T13:00:00.000Z");
    const releaseResult: ReleaseResult = {
      referencePeriod: "2026-06",
      observedAt: "2026-07-15T12:05:00.000Z",
      sourceName: "BLS API",
      sourceUrl: "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      observations: [
        {
          metric: "headline_cpi_sa_mom",
          actual: 0.1,
          unit: "percent",
          sourceSeriesId: "CUSR0000SA0",
          sourcePeriod: "2026-M06",
          transformation: "mom-change",
        },
        {
          metric: "headline_cpi_sa_yoy",
          actual: 2.75,
          unit: "percent",
          sourceSeriesId: "CUSR0000SA0",
          sourcePeriod: "2026-M06",
          transformation: "yoy-change",
        },
      ],
      consensus: null,
      surprise: null,
      surpriseStatus: "unavailable",
    };
    const checked = applyStructuredCrossCheck(
      brief,
      indexStructuredReleases([
        {
          releaseFamily: "cpi",
          referencePeriod: "2026-06",
          releaseResult,
        },
      ]),
    );
    expect(checked.warnings.some((w) => w.includes("crossCheck:matched"))).toBe(
      true,
    );
    // 2.7 vs 2.75 is within 0.05 tol → matched; invent mismatch:
    const mismatchResult: ReleaseResult = {
      ...releaseResult,
      observations: [
        {
          metric: "headline_cpi_sa_mom",
          actual: 0.5,
          unit: "percent",
          sourceSeriesId: "CUSR0000SA0",
          sourcePeriod: "2026-M06",
          transformation: "mom-change",
        },
      ],
    };
    const mismatched = applyStructuredCrossCheck(
      brief,
      indexStructuredReleases([
        {
          releaseFamily: "cpi",
          referencePeriod: "2026-06",
          releaseResult: mismatchResult,
        },
      ]),
    );
    expect(
      mismatched.warnings.some((w) => w.includes("crossCheck:mismatch")),
    ).toBe(true);
    const mom = mismatched.facts.find((f) =>
      f.values?.some((v) => v.metric === "headline_cpi_sa_mom"),
    );
    expect(mom?.values?.[0]?.value).toBe(0.1);
  });
});

describe("build workflow", () => {
  it("idempotent on same hash+version; revises on content change; isolates failures", () => {
    const root = tempRoot();
    const docs = [
      makeDoc({
        id: "odoc_cpi_b",
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
        title: "Consumer Price Index — June 2026",
        publishedAt: "2026-07-15T12:30:00.000Z",
        observedAt: "2026-07-15T12:35:00.000Z",
        documentType: "cpi_release",
        releaseFamily: "cpi",
        referencePeriod: "2026-06",
        contentText: CPI_BODY,
        synthetic: false,
      }),
      makeDoc({
        id: "odoc_bad",
        provider: "bea",
        sourceName: "BEA",
        canonicalUrl: "https://www.bea.gov/news/2026/broken",
        title: "Broken",
        publishedAt: "2026-07-01T12:30:00.000Z",
        observedAt: "2026-07-01T12:40:00.000Z",
        documentType: "gdp_release",
        releaseFamily: "gdp",
        contentText: "no gdp numbers",
        synthetic: false,
      }),
    ];

    const first = buildOfficialBriefs({
      now: new Date("2026-07-29T12:00:00.000Z"),
      dataRoot: root,
      documents: docs,
      write: true,
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.briefs.length).toBe(2);
    expect(first.cache.extractorVersion).toBe(BRIEF_EXTRACTOR_VERSION);

    const second = buildOfficialBriefs({
      now: new Date("2026-07-29T13:00:00.000Z"),
      dataRoot: root,
      documents: docs,
      write: true,
    });
    expect(second.cache.briefs[0]?.id).toBe(first.cache.briefs[0]?.id);
    expect(
      second.cache.revisions.filter((r) => r.reason === "document_revision"),
    ).toHaveLength(0);

    const revisedDocs = [
      makeDoc({
        ...docs[0]!,
        contentText: CPI_BODY + "\nAdditional sentence for revision.",
        contentHash: undefined,
      }),
      docs[1]!,
    ];
    const third = buildOfficialBriefs({
      now: new Date("2026-07-29T14:00:00.000Z"),
      dataRoot: root,
      documents: revisedDocs,
      write: true,
    });
    expect(
      third.cache.revisions.some(
        (r) => r.documentId === docs[0]!.id && r.reason === "document_revision",
      ),
    ).toBe(true);

    expect(() =>
      buildOfficialBriefs({
        dataRoot: tempRoot(),
        write: false,
      }),
    ).toThrow(/documents cache/);
  });

  it("preserves prior cache when build fully fails", () => {
    const root = tempRoot();
    const ok = buildOfficialBriefs({
      now: new Date("2026-07-29T12:00:00.000Z"),
      dataRoot: root,
      documents: [
        makeDoc({
          id: "odoc_ok",
          provider: "bls",
          sourceName: "BLS",
          canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
          title: "Consumer Price Index — June 2026",
          publishedAt: "2026-07-15T12:30:00.000Z",
          observedAt: "2026-07-15T12:35:00.000Z",
          documentType: "cpi_release",
          releaseFamily: "cpi",
          referencePeriod: "2026-06",
          contentText: CPI_BODY,
          synthetic: false,
        }),
      ],
      write: true,
    });
    const before = readFileSync(briefsLatestPath(root), "utf8");
    expect(ok.path).toBeTruthy();

    // Force failed build by emptying docs after a successful write is not the path —
    // failed = all document extract throws. Use empty documents throws before write.
    expect(() =>
      buildOfficialBriefs({
        dataRoot: root,
        documents: [],
        write: true,
      }),
    ).toThrow(/empty/);
    expect(readFileSync(briefsLatestPath(root), "utf8")).toBe(before);
  });

  it("separates archive from 30-day feed window", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const docs = Array.from({ length: 40 }, (_, i) => {
      const published = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      return makeDoc({
        id: `odoc_old_${i}`,
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: `https://www.bls.gov/news.release/archives/cpi_${i}.htm`,
        title: `Consumer Price Index — archive ${i}`,
        publishedAt: published.toISOString(),
        observedAt: published.toISOString(),
        documentType: "cpi_release",
        releaseFamily: "cpi",
        contentText: CPI_BODY,
        synthetic: false,
      });
    });
    const { cache } = buildOfficialBriefs({
      now,
      documents: docs,
      write: false,
    });
    const feed = filterBriefsForFeed(
      cache.briefs,
      publishedAtMapFromDocuments(docs),
      now,
      30,
    );
    expect(cache.briefs.length).toBe(40);
    expect(feed.length).toBeLessThanOrEqual(31);
    expect(feed.length).toBeGreaterThan(20);
  });

  it("exposes missing/malformed briefs cache", () => {
    const root = tempRoot();
    const missing = loadBriefsCache({ dataRoot: root });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");
    mkdirSync(join(root, "catalyst"), { recursive: true });
    writeFileSync(briefsLatestPath(root), "{bad");
    const bad = loadBriefsCache({ dataRoot: root });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("malformed");
  });
});

describe("public-demo isolation", () => {
  it("refuses briefs build in public demo and derives synthetic briefs offline", () => {
    expect(() =>
      buildOfficialBriefs({ publicDemo: true, documents: [] }),
    ).toThrow(/public demo/i);

    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, now: new Date("2026-07-29T18:00:00.000Z") },
    );
    expect(feed.source.briefs?.status).toBe("synthetic");
    expect(feed.briefs?.length).toBeGreaterThan(0);
    expect(feed.briefs?.every((b) => b.synthetic)).toBe(true);
    for (const b of feed.briefs ?? []) {
      for (const f of b.facts) {
        expect(f.evidence.excerpt.length).toBeGreaterThan(0);
      }
    }
    // Briefs must not invent hawkish/dovish or trading language
    for (const b of feed.briefs ?? []) {
      expect(b.headline).not.toMatch(/hawkish|dovish|buy|sell|bullish|bearish/i);
    }
  });
});

describe("atomic write path", () => {
  it("writes briefs-latest.json when build succeeds", () => {
    const root = tempRoot();
    const { path } = buildOfficialBriefs({
      dataRoot: root,
      documents: [
        makeDoc({
          id: "odoc_w",
          provider: "bls",
          sourceName: "BLS",
          canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
          title: "Consumer Price Index — June 2026",
          publishedAt: "2026-07-15T12:30:00.000Z",
          observedAt: "2026-07-15T12:35:00.000Z",
          documentType: "cpi_release",
          releaseFamily: "cpi",
          referencePeriod: "2026-06",
          contentText: CPI_BODY,
          synthetic: false,
        }),
      ],
      write: true,
    });
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
  });
});
