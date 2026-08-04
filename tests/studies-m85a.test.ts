import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DailyResearchArchive,
  StudyForwardOutcome,
  StudyPriceSeries,
  buildStudyId,
} from "@/contracts";
import { parseTiingoEtfRows, writeSpyBars, type SpyBarSeries } from "@/ingest";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  buildStudyDefinition,
  buildStudyForwardOutcome,
  buildStudyPriceSeriesFromSpyBars,
  ingestStudyPrices,
  normalizeSpyBarsToStudyBars,
  resolvePriceSourceKind,
  StudyPriceIngestError,
  studyPriceSeriesPath,
} from "@/studies";

const ARCHIVE_PATH =
  "fixtures/studies/archive/2026-07-29/daily-research.json";
const FIXTURE_PRICE_PATH = "fixtures/studies/prices/spy.m52.json";

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "fixtures/macro/ingest", name),
    "utf8",
  );
}

function loadArchive() {
  return DailyResearchArchive.parse(
    JSON.parse(readFileSync(join(process.cwd(), ARCHIVE_PATH), "utf8")),
  );
}

/** Trading sessions from 2026-07-15 through 2026-08-29 (matches spy.m52 calendar). */
function extendedSpyBars(): SpyBarSeries["bars"] {
  const rows = JSON.parse(fixture("tiingo-spy-sample.json")) as Record<
    string,
    unknown
  >[];
  const parsed = parseTiingoEtfRows(rows, "tiingo/daily/spy");
  const extraDates = [
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
    "2026-07-31",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
  ];
  let price = 540;
  const extra = extraDates.map((sessionDate) => {
    price += 0.5;
    return {
      sessionDate,
      value: price,
      source: "tiingo/daily/spy",
      rawDate: `${sessionDate}T00:00:00.000Z`,
    };
  });
  const merged = [...extra, ...parsed].sort((a, b) =>
    a.sessionDate < b.sessionDate ? -1 : 1,
  );
  const seen = new Set<string>();
  return merged.filter((b) => {
    if (seen.has(b.sessionDate)) return false;
    seen.add(b.sessionDate);
    return true;
  });
}

function writeTempSpyBars(root: string, bars = extendedSpyBars()): string {
  return writeSpyBars(
    {
      symbol: "SPY",
      instrument: "SPY",
      isProxy: false,
      source: "tiingo/daily/spy",
      bars,
    },
    root,
  );
}

describe("M8-5a SPY price normalization", () => {
  it("normalizes Tiingo rows into strictly increasing StudyPriceBar rows", () => {
    const rows = JSON.parse(fixture("tiingo-spy-sample.json")) as Record<
      string,
      unknown
    >[];
    const bars = parseTiingoEtfRows(rows, "tiingo/daily/spy");
    const normalized = normalizeSpyBarsToStudyBars(bars);
    expect(normalized.map((b) => b.sessionDate)).toEqual([
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
    ]);
    expect(normalized.every((b) => b.adjClose > 0)).toBe(true);
  });

  it("rejects duplicate and out-of-order bars", () => {
    expect(() =>
      normalizeSpyBarsToStudyBars([
        {
          sessionDate: "2026-07-28",
          value: 100,
          source: "tiingo/daily/spy",
          rawDate: "2026-07-28T00:00:00.000Z",
        },
        {
          sessionDate: "2026-07-28",
          value: 101,
          source: "tiingo/daily/spy",
          rawDate: "2026-07-28T00:00:00.000Z",
        },
      ]),
    ).toThrow(/duplicate sessionDate/i);

    expect(() =>
      normalizeSpyBarsToStudyBars([
        {
          sessionDate: "2026-07-29",
          value: 100,
          source: "tiingo/daily/spy",
          rawDate: "2026-07-29T00:00:00.000Z",
        },
        {
          sessionDate: "2026-07-28",
          value: 99,
          source: "tiingo/daily/spy",
          rawDate: "2026-07-28T00:00:00.000Z",
        },
      ]),
    ).toThrow(/strictly increasing/i);

    expect(() =>
      normalizeSpyBarsToStudyBars([
        {
          sessionDate: "2026-07-28",
          value: -1,
          source: "tiingo/daily/spy",
          rawDate: "2026-07-28T00:00:00.000Z",
        },
      ]),
    ).toThrow(/invalid adjClose/i);
  });
});

describe("M8-5a exact-date StudyPriceSeries build", () => {
  let tempRoot: string;

  it("truncates at exact asOf and writes atomic artifact with provenance", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "m85a-prices-"));
    writeTempSpyBars(tempRoot);

    const result = ingestStudyPrices({
      asOfSessionDate: "2026-07-29",
      dataRoot: tempRoot,
      ingestedAt: "2026-08-01T00:00:00.000Z",
    });

    expect(result.series.synthetic).toBe(false);
    expect(result.series.provenance).toMatchObject({
      sourceKind: "local_store",
      asOfSessionDate: "2026-07-29",
      barCount: result.series.bars.length,
      sourceArtifactRef: {
        relativePath: "bars/SPY.json",
        vendor: "tiingo/daily/spy",
      },
    });
    expect(result.series.bars.at(-1)?.sessionDate).toBe("2026-07-29");
    expect(result.series.bars.every((b) => b.sessionDate <= "2026-07-29")).toBe(
      true,
    );
    expect(existsSync(result.artifactPath)).toBe(true);

    const reread = StudyPriceSeries.parse(
      JSON.parse(readFileSync(result.artifactPath, "utf8")),
    );
    expect(reread).toEqual(result.series);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rejects missing exact-date coverage — no latest fallback", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "m85a-missing-"));
    writeTempSpyBars(tempRoot);
    expect(() =>
      buildStudyPriceSeriesFromSpyBars({
        barsFile: {
          symbol: "SPY",
          instrument: "SPY",
          isProxy: false,
          source: "tiingo/daily/spy",
          writtenAt: "2026-08-01T00:00:00.000Z",
          bars: extendedSpyBars(),
        },
        asOfSessionDate: "2026-09-01",
        ingestedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(/not in SPY bars|no latest-fallback/i);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("excludes future bars from cached SPY.json when truncating", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "m85a-future-"));
    writeTempSpyBars(tempRoot);
    const result = ingestStudyPrices({
      asOfSessionDate: "2026-07-28",
      dataRoot: tempRoot,
      ingestedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.series.bars.at(-1)?.sessionDate).toBe("2026-07-28");
    expect(
      result.series.bars.every((b) => b.sessionDate <= "2026-07-28"),
    ).toBe(true);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rejects fixture-backed SPY bars", () => {
    expect(() =>
      buildStudyPriceSeriesFromSpyBars({
        barsFile: {
          symbol: "SPY",
          instrument: "SPY",
          isProxy: false,
          source: "fixtures/studies/prices/spy.m52.json",
          writtenAt: "2026-08-01T00:00:00.000Z",
          bars: [
            {
              sessionDate: "2026-07-29",
              value: 100,
              source: "fixtures/studies/prices/spy.m52.json",
              rawDate: "2026-07-29T00:00:00.000Z",
            },
          ],
        },
        asOfSessionDate: "2026-07-29",
        ingestedAt: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(/fixture-backed SPY bars rejected/i);
  });
});

describe("M8-5a outcome integration with real price series", () => {
  let tempRoot: string;

  function buildRealPriceSeries(asOf: string) {
    tempRoot = mkdtempSync(join(tmpdir(), "m85a-outcome-"));
    writeTempSpyBars(tempRoot);
    return ingestStudyPrices({
      asOfSessionDate: asOf,
      dataRoot: tempRoot,
      ingestedAt: "2026-08-30T12:00:00.000Z",
    });
  }

  it("generates real outcomes with local_store provenance when horizons mature", () => {
    const { series } = buildRealPriceSeries("2026-08-29");
    const relPath = studyPriceSeriesPath(tempRoot, "SPY", "2026-08-29").slice(
      tempRoot.length + 1,
    );
    expect(resolvePriceSourceKind(series, relPath)).toBe("local_store");

    const definition = buildStudyDefinition({
      archive: loadArchive(),
      symbol: "SPY",
      archiveRelativePath: ARCHIVE_PATH,
      builtAt: "2026-08-30T12:00:00.000Z",
      synthetic: false,
    });

    const outcome = buildStudyForwardOutcome({
      definition,
      priceSeries: series,
      priceSeriesAsOfSessionDate: "2026-08-29",
      computedAt: "2026-08-30T12:00:00.000Z",
      priceSourceKind: "local_store",
      priceRelativePath: relPath,
    });

    expect(StudyForwardOutcome.safeParse(outcome).success).toBe(true);
    expect(outcome.provenance).toMatchObject({
      priceSourceKind: "local_store",
      synthetic: false,
      instrument: "SPY",
    });
    expect(outcome.maturity.every((m) => m.status === "mature")).toBe(true);
    expect(outcome.returns.d5.status).toBe("available");
    expect(outcome.returns.d20.status).toBe("available");
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("marks 5D/20D immature when as-of coverage is insufficient", () => {
    const { series } = buildRealPriceSeries("2026-07-30");
    const relPath = studyPriceSeriesPath(tempRoot, "SPY", "2026-07-30").slice(
      tempRoot.length + 1,
    );
    const definition = buildStudyDefinition({
      archive: loadArchive(),
      symbol: "SPY",
      archiveRelativePath: ARCHIVE_PATH,
      builtAt: "2026-07-31T12:00:00.000Z",
      synthetic: false,
    });
    const outcome = buildStudyForwardOutcome({
      definition,
      priceSeries: series,
      priceSeriesAsOfSessionDate: "2026-07-30",
      computedAt: "2026-07-31T12:00:00.000Z",
      priceSourceKind: "local_store",
      priceRelativePath: relPath,
    });
    expect(outcome.returns.d1.status).toBe("available");
    expect(outcome.returns.d5.status).toBe("unavailable");
    expect(outcome.returns.d20.status).toBe("unavailable");
    expect(outcome.maturity.find((m) => m.horizon === "5D")?.status).toBe(
      "immature",
    );
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("keeps fixture-backed outcomes distinguishable from real", () => {
    const fixtureSeries = StudyPriceSeries.parse(
      JSON.parse(
        readFileSync(join(process.cwd(), FIXTURE_PRICE_PATH), "utf8"),
      ),
    );
    expect(resolvePriceSourceKind(fixtureSeries, FIXTURE_PRICE_PATH)).toBe(
      "fixture",
    );

    const definition = buildStudyDefinition({
      archive: loadArchive(),
      symbol: "SPY",
      archiveRelativePath: ARCHIVE_PATH,
      builtAt: "2026-08-30T12:00:00.000Z",
      synthetic: true,
    });
    const outcome = buildStudyForwardOutcome({
      definition,
      priceSeries: fixtureSeries,
      priceSeriesAsOfSessionDate: "2026-08-29",
      computedAt: "2026-08-30T12:00:00.000Z",
      priceRelativePath: FIXTURE_PRICE_PATH,
    });
    expect(outcome.provenance.priceSourceKind).toBe("fixture");
    expect(outcome.provenance.synthetic).toBe(true);
    expect(
      buildStudyId("research|2026-07-29|0.1.0", "SPY"),
    ).toBe(definition.studyId);
  });

  it("rejects non-synthetic series on fixture path", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "m85a-reject-fix-"));
    const { series } = ingestStudyPrices({
      asOfSessionDate: "2026-07-29",
      dataRoot: (writeTempSpyBars(tempRoot), tempRoot),
      ingestedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(() =>
      resolvePriceSourceKind(series, FIXTURE_PRICE_PATH),
    ).toThrow(/cannot use fixture path/i);
    rmSync(tempRoot, { recursive: true, force: true });
  });
});

describe("M8-5a public-demo isolation", () => {
  it("does not treat public demo mode as real price ingestion", () => {
    expect(isPublicDemoMode({ GAMMADESK_PUBLIC_DEMO: "1" })).toBe(true);
    expect(isPublicDemoMode({})).toBe(false);
  });

  it("fixture pipeline manifest still references synthetic prices for CI", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/studies/pipeline.m64.json"),
        "utf8",
      ),
    ) as { query: { priceSeriesPath: string } };
    expect(manifest.query.priceSeriesPath).toMatch(/^fixtures\//);
  });
});

describe("M8-5a parseTiingoEtfRows for SPY", () => {
  it("parses tiingo-spy-sample fixture", () => {
    const rows = JSON.parse(fixture("tiingo-spy-sample.json")) as Record<
      string,
      unknown
    >[];
    const bars = parseTiingoEtfRows(rows, "tiingo/daily/spy");
    expect(bars.length).toBe(3);
    expect(bars[0]!.sessionDate).toBe("2026-07-28");
  });
});
