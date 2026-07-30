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
  buildOfficialDocument,
  documentContentHash,
  extractOfficialContentText,
  extractReferencePeriodFromTitle,
  fetchBeaDocuments,
  fetchBlsDocuments,
  fetchFedDocuments,
  fetchOfficialDocuments,
  filterDocumentsForFeed,
  linkDocumentsToCatalysts,
  loadCatalystFeed,
  loadDocumentsCache,
  parseRssOrAtom,
  validateCanonicalOfficialUrl,
  BEA_ITEM_NAME_REGISTRY,
  FOMC_STATEMENT_TITLE_EXACT,
  documentsLatestPath,
} from "@/catalyst";
import type { Catalyst, OfficialDocument } from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";

const FIXTURE_ROOT = join(process.cwd(), "fixtures/catalyst/providers");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function tempDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m23a-"));
}

function mockResponse(
  body: string,
  contentType: string,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

async function mockDocumentFetch(url: string): Promise<Response> {
  if (url.includes("press_monetary.xml")) {
    return mockResponse(readFixture("fed-monetary-rss.xml"), "text/xml");
  }
  if (url.includes("/feed/cpi.rss")) {
    return mockResponse(readFixture("bls-cpi-rss.xml"), "application/rss+xml");
  }
  if (url.includes("/feed/empsit.rss")) {
    return mockResponse(readFixture("bls-empsit-rss.xml"), "application/xml");
  }
  if (url.includes("apps.bea.gov/rss/rss.xml")) {
    return mockResponse(readFixture("bea-news-rss.xml"), "text/xml");
  }
  if (url.includes("monetary20260729a.htm")) {
    return mockResponse(readFixture("fomc-statement-sample.html"), "text/html");
  }
  if (url.includes("bls.gov") || url.includes("bea.gov")) {
    return mockResponse(
      "<html><body><main><article><p>Official release body fixture.</p></article></main></body></html>",
      "text/html",
    );
  }
  return mockResponse("unexpected", "text/plain", 404);
}

function baseCatalyst(overrides: Partial<Catalyst> = {}): Catalyst {
  return {
    schemaVersion: "0.1.0",
    id: "cat_test_cpi",
    occurredAt: "2026-07-15T12:30:00.000Z",
    observedAt: "2026-07-15T12:30:00.000Z",
    sourceType: "calendar",
    sourceName: "BLS News Release Schedule",
    sourceUrl: "https://www.bls.gov/schedule/news_release/",
    headline: "Consumer Price Index (CPI) scheduled release",
    summary: "Scheduled CPI.",
    category: "inflation",
    importance: "high",
    status: "upcoming",
    affectedAssets: ["US10Y"],
    macroChannels: ["inflation"],
    direction: "unclear",
    confidence: {
      score: 80,
      calibrated: false,
      note: "classification clarity only — not a market direction probability",
    },
    evidence: [
      {
        id: "ev1",
        statement: "schedule",
        basis: "official_release_schedule",
      },
    ],
    dedupeKey: "ext:test-cpi",
    synthetic: false,
    releaseFamily: "cpi",
    referencePeriod: "2026-06",
    ...overrides,
  };
}

describe("RSS/Atom parse", () => {
  it("handles CDATA, entities, and namespaced RSS", () => {
    const { items, format } = parseRssOrAtom(readFixture("fed-monetary-rss.xml"));
    expect(format).toBe("rss");
    expect(items[0]?.title).toBe(FOMC_STATEMENT_TITLE_EXACT);
    expect(items[0]?.link).toContain("federalreserve.gov");
    expect(items[0]?.description).toBe("Federal Reserve issues FOMC statement");
  });

  it("parses BLS CPI feed with escaped entities", () => {
    const { items } = parseRssOrAtom(readFixture("bls-cpi-rss.xml"));
    expect(items).toHaveLength(2);
    expect(items[1]?.description).toContain("&");
    expect(items[0]?.title).toContain("June 2026");
  });

  it("rejects malformed non-XML", () => {
    expect(() => parseRssOrAtom("not xml at all")).toThrow(/not XML/i);
  });
});

describe("canonical URL + HTML cleanup + hash", () => {
  it("allows official hosts and rejects others", () => {
    expect(
      validateCanonicalOfficialUrl(
        "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
        "federal_reserve",
      ).ok,
    ).toBe(true);
    expect(
      validateCanonicalOfficialUrl(
        "https://news.google.com/rss",
        "federal_reserve",
      ).ok,
    ).toBe(false);
    expect(
      validateCanonicalOfficialUrl("http://www.bls.gov/feed/cpi.rss", "bls").ok,
    ).toBe(false);
  });

  it("strips nav/footer/script and hashes stably", () => {
    const text = extractOfficialContentText(
      readFixture("fomc-statement-sample.html"),
    );
    expect(text).toContain("maintain the target range");
    expect(text).not.toMatch(/Primary navigation/i);
    expect(text).not.toMatch(/Footer boilerplate/i);
    expect(text).not.toContain("__noise");
    const h1 = documentContentHash({ title: "t", contentText: text });
    const h2 = documentContentHash({ title: "t", contentText: text });
    expect(h1).toBe(h2);
  });
});

describe("document-type registry + reference periods", () => {
  it("maps only explicit BEA item names", () => {
    expect(BEA_ITEM_NAME_REGISTRY["Gross Domestic Product"]?.documentType).toBe(
      "gdp_release",
    );
    expect(BEA_ITEM_NAME_REGISTRY["Gross Domestic Product by State"]).toBeUndefined();
  });

  it("extracts YYYY-MM and YYYY-Qn from official titles", () => {
    expect(extractReferencePeriodFromTitle("Consumer Price Index - June 2026")).toBe(
      "2026-06",
    );
    expect(
      extractReferencePeriodFromTitle("THE EMPLOYMENT SITUATION -- JUNE 2026"),
    ).toBe("2026-06");
    expect(
      extractReferencePeriodFromTitle(
        "Gross Domestic Product, 1st Quarter 2026 (Third Estimate)",
      ),
    ).toBe("2026-Q1");
    expect(
      extractReferencePeriodFromTitle("Federal Reserve issues FOMC statement"),
    ).toBeUndefined();
  });
});

describe("providers (mocked)", () => {
  it("Fed maps only FOMC statement; ignores minutes/SEP", async () => {
    const result = await fetchFedDocuments({
      observedAt: "2026-07-29T20:00:00.000Z",
      fetchImpl: mockDocumentFetch,
      fetchBodies: true,
    });
    expect(result.source.status).toBe("ok");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.documentType).toBe("fomc_statement");
    expect(result.documents[0]?.contentText).toContain("target range");
    expect(result.documents[0]?.summaryFromSource).toBe(
      "Federal Reserve issues FOMC statement",
    );
  });

  it("BLS CPI + Employment RSS build documents with periods", async () => {
    const result = await fetchBlsDocuments({
      observedAt: "2026-07-29T20:00:00.000Z",
      fetchImpl: mockDocumentFetch,
      fetchBodies: false,
    });
    expect(result.source.status).toBe("ok");
    expect(result.documents.length).toBeGreaterThanOrEqual(2);
    const cpi = result.documents.find((d) => d.documentType === "cpi_release");
    expect(cpi?.referencePeriod).toBe("2026-06");
  });

  it("BEA filters national GDP / PI / Trade only", async () => {
    const result = await fetchBeaDocuments({
      observedAt: "2026-07-29T20:00:00.000Z",
      fetchImpl: mockDocumentFetch,
      fetchBodies: false,
    });
    expect(result.source.status).toBe("ok");
    const types = new Set(result.documents.map((d) => d.documentType));
    expect(types.has("gdp_release")).toBe(true);
    expect(types.has("personal_income_outlays_release")).toBe(true);
    expect(types.has("international_trade_release")).toBe(true);
    expect(
      result.documents.some((d) => d.title.includes("by State")),
    ).toBe(false);
  });

  it("records content-type / timeout failures per provider", async () => {
    const bad = await fetchFedDocuments({
      observedAt: "2026-07-29T20:00:00.000Z",
      fetchImpl: async () => mockResponse("<html>nope</html>", "text/html"),
    });
    expect(bad.source.status).toBe("error");
    expect(bad.source.error).toMatch(/content-type|xml/i);

    const timed = await fetchBeaDocuments({
      observedAt: "2026-07-29T20:00:00.000Z",
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    expect(timed.source.status).toBe("error");
    expect(timed.source.error).toMatch(/timed out/i);
  });
});

describe("document→catalyst linking", () => {
  it("links by releaseFamily + referencePeriod without duplicating catalysts", () => {
    const doc: OfficialDocument = {
      schemaVersion: "0.1.0",
      id: "odoc_test",
      provider: "bls",
      sourceName: "BLS CPI",
      canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      title: "Consumer Price Index - June 2026",
      publishedAt: "2026-07-15T12:30:00.000Z",
      observedAt: "2026-07-15T13:00:00.000Z",
      documentType: "cpi_release",
      releaseFamily: "cpi",
      referencePeriod: "2026-06",
      summaryFromSource: "Source abstract",
      contentHash: "abc",
      synthetic: false,
    };
    const before = [baseCatalyst()];
    const linked = linkDocumentsToCatalysts(before, [doc]);
    expect(linked.catalysts).toHaveLength(1);
    expect(linked.linkedCount).toBe(1);
    expect(linked.catalysts[0]?.officialDocuments?.[0]?.canonicalUrl).toBe(
      doc.canonicalUrl,
    );
    expect(
      linked.catalysts[0]?.evidence.some(
        (e) => e.basis === "official_release_document",
      ),
    ).toBe(true);
    expect(linked.catalysts[0]?.direction).toBe("unclear");
  });

  it("warns on unmatched documents and does not invent merges", () => {
    const doc: OfficialDocument = {
      schemaVersion: "0.1.0",
      id: "odoc_unmatched",
      provider: "bls",
      sourceName: "BLS CPI",
      canonicalUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      title: "Consumer Price Index - January 2020",
      publishedAt: "2020-02-13T12:30:00.000Z",
      observedAt: "2026-07-29T00:00:00.000Z",
      documentType: "cpi_release",
      releaseFamily: "cpi",
      referencePeriod: "2020-01",
      contentHash: "xyz",
      synthetic: false,
    };
    const linked = linkDocumentsToCatalysts([baseCatalyst()], [doc]);
    expect(linked.linkedCount).toBe(0);
    expect(linked.linkingWarnings[0]?.reason).toBe("no_matching_catalyst");
  });

  it("links FOMC statement to policy-decision catalyst by Eastern day", () => {
    const fomc = baseCatalyst({
      id: "cat_fomc",
      headline: "FOMC policy decision (scheduled)",
      category: "monetary-policy",
      occurredAt: "2026-07-29T18:00:00.000Z",
      releaseFamily: undefined,
      referencePeriod: undefined,
      dedupeKey: "ext:fomc",
    });
    const doc: OfficialDocument = {
      schemaVersion: "0.1.0",
      id: "odoc_fomc",
      provider: "federal_reserve",
      sourceName: "Fed",
      canonicalUrl:
        "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm",
      title: FOMC_STATEMENT_TITLE_EXACT,
      publishedAt: "2026-07-29T18:00:00.000Z",
      observedAt: "2026-07-29T18:05:00.000Z",
      documentType: "fomc_statement",
      releaseFamily: "fomc_policy",
      contentHash: "f",
      synthetic: false,
    };
    const linked = linkDocumentsToCatalysts([fomc], [doc]);
    expect(linked.linkedCount).toBe(1);
    expect(linked.catalysts[0]?.officialDocuments?.[0]?.documentType).toBe(
      "fomc_statement",
    );
  });
});

describe("archive vs 30-day feed + revisions + cache", () => {
  it("keeps archive larger than default feed window", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const docs: OfficialDocument[] = [];
    for (let i = 0; i < 40; i++) {
      const published = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      docs.push({
        schemaVersion: "0.1.0",
        id: `odoc_${i}`,
        provider: "bls",
        sourceName: "BLS",
        canonicalUrl: `https://www.bls.gov/news.release/archives/cpi_${i}.htm`,
        title: `Consumer Price Index - archive ${i}`,
        publishedAt: published.toISOString(),
        observedAt: now.toISOString(),
        documentType: "cpi_release",
        releaseFamily: "cpi",
        contentHash: `h${i}`,
        synthetic: false,
      });
    }
    const feed = filterDocumentsForFeed(docs, now, 30);
    expect(docs).toHaveLength(40);
    expect(feed.length).toBeLessThanOrEqual(31);
    expect(feed.length).toBeGreaterThan(20);
  });

  it("records content-hash revisions and is idempotent on duplicate fetch", async () => {
    const root = tempDataRoot();
    const now = new Date("2026-07-29T20:00:00.000Z");
    const first = await fetchOfficialDocuments({
      now,
      dataRoot: root,
      fetchImpl: mockDocumentFetch,
      write: true,
      fetchBodies: true,
    });
    expect(first.path).toBeTruthy();
    expect(first.cache.documents.length).toBeGreaterThan(0);

    const second = await fetchOfficialDocuments({
      now: new Date("2026-07-29T21:00:00.000Z"),
      dataRoot: root,
      fetchImpl: mockDocumentFetch,
      write: true,
      fetchBodies: true,
    });
    expect(second.cache.revisions.filter((r) => r.observedAt.startsWith("2026-07-29T21"))).toHaveLength(0);

    // Mutate body for same URL → revision
    const mutatedFetch = async (url: string): Promise<Response> => {
      if (url.includes("monetary20260729a.htm")) {
        return mockResponse(
          "<html><body><main><article><p>Revised official statement body.</p></article></main></body></html>",
          "text/html",
        );
      }
      return mockDocumentFetch(url);
    };
    const third = await fetchOfficialDocuments({
      now: new Date("2026-07-29T22:00:00.000Z"),
      dataRoot: root,
      fetchImpl: mutatedFetch,
      write: true,
      fetchBodies: true,
    });
    expect(
      third.cache.revisions.some((r) =>
        r.canonicalUrl.includes("monetary20260729a"),
      ),
    ).toBe(true);
  });

  it("writes on partial failure and preserves cache on all-fail", async () => {
    const root = tempDataRoot();
    const ok = await fetchOfficialDocuments({
      now: new Date("2026-07-29T20:00:00.000Z"),
      dataRoot: root,
      fetchImpl: mockDocumentFetch,
      write: true,
      fetchBodies: false,
    });
    expect(ok.path).toBeTruthy();
    const before = readFileSync(documentsLatestPath(root), "utf8");

    const allFail = await fetchOfficialDocuments({
      now: new Date("2026-07-29T21:00:00.000Z"),
      dataRoot: root,
      fetchImpl: async () => mockResponse("nope", "text/plain", 500),
      write: true,
    });
    expect(allFail.path).toBeNull();
    expect(readFileSync(documentsLatestPath(root), "utf8")).toBe(before);

    const partial = await fetchOfficialDocuments({
      now: new Date("2026-07-29T22:00:00.000Z"),
      dataRoot: root,
      fetchImpl: async (url: string) => {
        if (url.includes("bls.gov/feed")) {
          return mockResponse("blocked", "text/html", 403);
        }
        return mockDocumentFetch(url);
      },
      write: true,
      fetchBodies: false,
    });
    expect(partial.path).toBeTruthy();
    expect(partial.cache.partialFailure).toBe(true);
  });

  it("exposes missing/corrupt cache distinctly", () => {
    const root = tempDataRoot();
    const missing = loadDocumentsCache({ dataRoot: root });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");

    const path = documentsLatestPath(root);
    mkdirSync(join(root, "catalyst"), { recursive: true });
    writeFileSync(path, "{not json");
    const bad = loadDocumentsCache({ dataRoot: root });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("malformed");
  });
});

describe("public-demo isolation + feed wiring", () => {
  it("refuses official document fetch in public demo", async () => {
    await expect(
      fetchOfficialDocuments({
        publicDemo: true,
        fetchImpl: mockDocumentFetch,
      }),
    ).rejects.toThrow(/public demo/i);
  });

  it("synthetic demo surfaces documents without growing catalyst count as docs", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true, now: new Date("2026-07-29T18:00:00.000Z") });
    expect(feed.source.documents?.status).toBe("synthetic");
    expect(feed.documents?.length).toBeGreaterThan(0);
    expect(feed.documents?.every((d) => d.synthetic)).toBe(true);
    const withDoc = feed.catalysts.filter(
      (c) => c.officialDocuments && c.officialDocuments.length > 0,
    );
    expect(withDoc.length).toBeGreaterThan(0);
    // Documents are not additional catalysts
    expect(feed.count).toBe(feed.catalysts.length);
  });

  it("buildOfficialDocument never invents source summaries", () => {
    const built = buildOfficialDocument({
      mapping: {
        documentType: "cpi_release",
        releaseFamily: "cpi",
        sourceName: "BLS",
      },
      item: {
        provider: "bls",
        sourceName: "BLS",
        feedUrl: "https://www.bls.gov/feed/cpi.rss",
        title: "Consumer Price Index - June 2026",
        link: "https://www.bls.gov/news.release/cpi.nr0.htm",
        publishedAtRaw: "Tue, 15 Jul 2026 12:30:00 GMT",
      },
      observedAt: "2026-07-15T13:00:00.000Z",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.document.summaryFromSource).toBeUndefined();
    }
  });
});

describe("atomic write helper still used for documents cache", () => {
  it("writeJsonAtomic lands at documents-latest path", () => {
    const root = tempDataRoot();
    const path = documentsLatestPath(root);
    writeJsonAtomic(path, { ok: true });
    expect(existsSync(path)).toBe(true);
  });
});
