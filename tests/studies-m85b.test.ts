import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  DailyResearchArchive,
  RealArchivePeerCorpus,
  buildResearchArchiveId,
  buildStudyId,
} from "@/contracts";
import { isPublicDemoMode } from "@/desk/public-demo";
import {
  ResearchArchiveStoreError,
  buildRealArchives,
  dailyResearchArchivePath,
  discoverDriverCandidates,
  exclusionMessage,
  EXCLUSION,
  inventoryRealArchiveSessions,
  isRejectedCatalystId,
  parseBuildArchiveArgs,
  parseInventoryArgs,
  readDailyResearchArchive,
  resolveExactDateStructure,
  resolvePitCatalysts,
  resolveRealArchiveSession,
  writeDailyResearchArchive,
} from "@/studies";

const DRIVER_FIXTURE =
  "fixtures/macro/dominant-driver.rates-led-easing.json";
const SNAPSHOT_FIXTURE =
  "fixtures/gamma/snapshots/SPX/2026-07-29/intraday_2026-07-29T150000.000Z.json";
const BOUNDED_FIXTURE =
  "fixtures/gamma/providers/marketdata-app/spy-bounded-ui.json";

function writeDriver(
  root: string,
  sessionDate: string,
  overrides: Record<string, unknown> = {},
): void {
  const base = JSON.parse(
    readFileSync(join(process.cwd(), DRIVER_FIXTURE), "utf8"),
  ) as Record<string, unknown>;
  const driver = {
    ...base,
    marketSessionDate: sessionDate,
    generatedAt: `${sessionDate}T12:00:00.000Z`,
    sessionAlignment: "aligned",
    isCompleteSession: true,
    staleDaysByAsset: Object.fromEntries(
      Object.keys((base.staleDaysByAsset as object) ?? {}).map((k) => [k, 0]),
    ),
    ...overrides,
  };
  mkdirSync(join(root, "drivers"), { recursive: true });
  writeFileSync(
    join(root, "drivers", `${sessionDate}.json`),
    JSON.stringify(driver, null, 2),
  );
}

function writeHistoricalSnapshot(root: string, sessionDate: string): void {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), SNAPSHOT_FIXTURE), "utf8"),
  ) as Record<string, unknown>;
  const structure = raw.structure as Record<string, unknown>;
  structure.sessionDate = sessionDate;
  structure.synthetic = false;
  structure.asOf = `${sessionDate}T15:00:00.000Z`;
  raw.sessionDate = sessionDate;
  raw.snapshotId = `SPX|${sessionDate}|intraday|${sessionDate}T15:00:00.000Z`;
  raw.asOf = `${sessionDate}T15:00:00.000Z`;
  raw.capturedAt = `${sessionDate}T15:00:00.000Z`;
  const dest = join(
    root,
    "gamma",
    "snapshots",
    "SPX",
    sessionDate,
    `intraday_${sessionDate}T150000.000Z.json`,
  );
  mkdirSync(join(root, "gamma", "snapshots", "SPX", sessionDate), {
    recursive: true,
  });
  writeFileSync(dest, JSON.stringify(raw, null, 2));
}

function writeBounded(root: string, sessionDate: string): void {
  const bounded = {
    ...JSON.parse(readFileSync(join(process.cwd(), BOUNDED_FIXTURE), "utf8")),
    sessionDate,
    synthetic: false,
    status: "available",
    vendorAsOf: `${sessionDate}T20:00:00.000Z`,
    generatedAt: `${sessionDate}T20:05:00.000Z`,
  };
  const dir = join(root, "gamma", "providers", "marketdata-app");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SPY-bounded-latest.json"), JSON.stringify(bounded, null, 2));
}

function writeMinimalCatalystCache(root: string, sessionDate: string): void {
  mkdirSync(join(root, "catalyst"), { recursive: true });
  writeFileSync(
    join(root, "catalyst", "calendar-latest.json"),
    JSON.stringify(
      {
        kind: "CatalystCalendarCache",
        schemaVersion: "0.1.0",
        fetchedAt: `${sessionDate}T10:00:00.000Z`,
        requestedWindow: {
          now: `${sessionDate}T10:00:00.000Z`,
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-08-31T00:00:00.000Z",
        },
        sources: [{ id: "bls", name: "BLS", status: "ok" }],
        catalysts: [
          {
            schemaVersion: "0.1.0",
            id: "cat_test_pit_001",
            occurredAt: `${sessionDate}T08:30:00.000Z`,
            observedAt: `${sessionDate}T08:30:00.000Z`,
            sourceType: "calendar",
            sourceName: "BLS",
            sourceUrl: "https://www.bls.gov/news.release/cpi.toc.htm",
            headline: "Test CPI release",
            summary: "Test fixture catalyst for M8-5b offline tests only.",
            category: "inflation",
            importance: "high",
            status: "released",
            affectedAssets: ["SPY"],
            macroChannels: ["inflation"],
            direction: "unclear",
            confidence: {
              score: 70,
              calibrated: false,
              note: "classification clarity only — not a market direction probability",
            },
            evidence: [
              {
                id: "ev1",
                statement: "Test observation",
                basis: "official_bls_series",
              },
            ],
            dedupeKey: "test:cpi",
            synthetic: false,
            releaseFamily: "cpi",
            referencePeriod: "2026-06",
            releaseResult: {
              referencePeriod: "2026-06",
              observedAt: `${sessionDate}T08:30:00.000Z`,
              sourceName: "BLS Public Data API",
              sourceUrl: "https://www.bls.gov/news.release/cpi.toc.htm",
              observations: [
                {
                  metric: "headline CPI YoY",
                  actual: 3.2,
                  unit: "%",
                  sourceSeriesId: "CUUR0000SA0",
                  sourcePeriod: "2026-M06",
                  transformation: "yoy-change",
                  preliminary: false,
                },
              ],
              consensus: null,
              surprise: null,
              surpriseStatus: "unavailable",
            },
          },
        ],
        validationErrors: [],
        partialFailure: false,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "catalyst", "results-latest.json"),
    JSON.stringify(
      {
        kind: "CatalystResultsCache",
        schemaVersion: "0.1.0",
        fetchedAt: `${sessionDate}T10:00:00.000Z`,
        sources: [{ id: "bls", name: "BLS", status: "ok" }],
        seriesMetadata: [],
        releases: [],
        revisions: [],
        validationErrors: [],
        partialFailure: false,
      },
      null,
      2,
    ),
  );
}

function seedEligibleSession(root: string, sessionDate: string): void {
  writeDriver(root, sessionDate);
  writeHistoricalSnapshot(root, sessionDate);
  writeBounded(root, sessionDate);
  writeMinimalCatalystCache(root, sessionDate);
}

describe("M8-5b real archive discovery", () => {
  it("requires explicit through date for inventory CLI", () => {
    expect(() => parseInventoryArgs([])).toThrow(/through is required/i);
  });

  it("discovers candidates only after validating marketSessionDate alignment", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-disc-"));
    writeDriver(root, "2026-07-29");
    const candidates = discoverDriverCandidates(root);
    expect(candidates.map((c) => c.sessionDate)).toEqual(["2026-07-29"]);
    expect(candidates[0]!.driverRelativePath).toBe("drivers/2026-07-29.json");
    rmSync(root, { recursive: true, force: true });
  });

  it("excludes future sessions after explicit cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-future-"));
    writeDriver(root, "2026-07-29");
    writeDriver(root, "2026-08-15");
    const report = inventoryRealArchiveSessions({
      throughDate: "2026-07-31",
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    const future = report.entries.find((e) => e.sessionDate === "2026-08-15");
    expect(future?.classification).toBe("ineligible");
    expect(future?.exclusionReasons.join(" ")).toMatch(/after cutoff/i);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("M8-5b structure and catalyst integrity", () => {
  it("rejects exact-date structure mismatch (no nearest fallback)", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-struct-"));
    writeDriver(root, "2026-07-29");
    writeBounded(root, "2026-07-30");
    const resolution = resolveExactDateStructure({
      sessionDate: "2026-07-29",
      dataRoot: root,
    });
    expect(resolution.resolved).toBeNull();
    expect(resolution.exclusionReasons.join(" ")).toMatch(/mismatch|missing/i);
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves historical snapshot with exact sessionDate", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-hist-"));
    writeHistoricalSnapshot(root, "2026-07-29");
    const resolution = resolveExactDateStructure({
      sessionDate: "2026-07-29",
      dataRoot: root,
    });
    expect(resolution.resolved?.kind).toBe("historical_snapshot");
    expect(resolution.resolved?.artifact.sessionDate).toBe("2026-07-29");
    expect(resolution.resolved?.relativePath).not.toMatch(/^\//);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects syn-* catalyst identifiers", () => {
    expect(isRejectedCatalystId("syn-cpi-2026-07-15")).toBe(true);
    expect(isRejectedCatalystId("cat_real_001")).toBe(false);
  });

  it("includes only PIT-available catalyst releases", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-cat-"));
    writeMinimalCatalystCache(root, "2026-07-29");
    const pit = resolvePitCatalysts({
      sessionDate: "2026-07-29",
      dataRoot: root,
      now: new Date("2026-07-29T18:00:00.000Z"),
    });
    expect(pit.artifacts.length).toBe(1);
    expect(pit.artifacts[0]!.catalystId).toBe("cat_test_pit_001");
    expect(pit.artifacts[0]!.synthetic).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("M8-5b archive and peer corpus build", () => {
  it("builds eligible non-synthetic archive with local_store provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-build-"));
    seedEligibleSession(root, "2026-07-29");
    const result = buildRealArchives({
      throughDate: "2026-07-31",
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.builtSessionDates).toEqual(["2026-07-29"]);
    const path = dailyResearchArchivePath(root, "2026-07-29");
    expect(existsSync(path)).toBe(true);
    const archive = readDailyResearchArchive(path);
    expect(DailyResearchArchive.safeParse(archive).success).toBe(true);
    expect(archive.eligibility.status).toBe("eligible");
    if (archive.components.macro.status === "available") {
      expect(archive.components.macro.provenance.sourceKind).toBe("local_store");
      expect(archive.components.macro.provenance.synthetic).toBe(false);
      expect(archive.components.macro.provenance.relativePath).not.toMatch(/^\//);
    }
    expect(JSON.stringify(archive)).not.toMatch(/forward-outcome|returns\.d5|"d20"/);
    rmSync(root, { recursive: true, force: true });
  });

  it("is idempotent and refuses divergent overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-idem-"));
    seedEligibleSession(root, "2026-07-29");
    buildRealArchives({
      throughDate: "2026-07-31",
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    expect(() =>
      buildRealArchives({
        throughDate: "2026-07-31",
        dataRoot: root,
        builtAt: "2026-08-01T00:00:00.000Z",
      }),
    ).not.toThrow();
    const path = dailyResearchArchivePath(root, "2026-07-29");
    const existing = readDailyResearchArchive(path);
    expect(() =>
      writeDailyResearchArchive(path, {
        ...existing,
        builtAt: "2026-08-02T00:00:00.000Z",
      }),
    ).toThrow(ResearchArchiveStoreError);
    rmSync(root, { recursive: true, force: true });
  });

  it("derives peer profiles from built archives with corpus reporting", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-corpus-"));
    seedEligibleSession(root, "2026-07-29");
    const result = buildRealArchives({
      throughDate: "2026-07-31",
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    expect(RealArchivePeerCorpus.safeParse(result.corpus).success).toBe(true);
    expect(result.corpus.synthetic).toBe(false);
    expect(result.corpus.sourceKind).toBe("local_store");
    expect(result.corpus.included).toHaveLength(1);
    expect(result.corpus.profiles).toHaveLength(1);
    expect(result.corpus.profiles[0]!.studyId).toBe(
      buildStudyId(buildResearchArchiveId("2026-07-29"), "SPY"),
    );
    expect(result.corpus.coverage.matchingViable).toBe(false);
    expect(result.corpus.excluded.length).toBeGreaterThanOrEqual(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not build archive for ineligible sessions (structure mismatch)", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-skip-"));
    writeDriver(root, "2026-07-29");
    writeBounded(root, "2026-07-30");
    writeMinimalCatalystCache(root, "2026-07-29");
    const result = buildRealArchives({
      throughDate: "2026-07-31",
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.builtSessionDates).toHaveLength(0);
    expect(result.skippedSessionDates).toContain("2026-07-29");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("M8-5b public-demo and CI isolation", () => {
  it("keeps default pipeline manifest on fixture prices", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/studies/pipeline.m64.json"),
        "utf8",
      ),
    ) as { query: { archivePath: string; priceSeriesPath: string } };
    expect(manifest.query.archivePath).toMatch(/^fixtures\//);
    expect(manifest.query.priceSeriesPath).toMatch(/^fixtures\//);
  });

  it("does not treat public demo mode as real archive ingestion", () => {
    expect(isPublicDemoMode({ GAMMADESK_PUBLIC_DEMO: "1" })).toBe(true);
    expect(isPublicDemoMode({})).toBe(false);
  });

  it("requires explicit through date for build CLI", () => {
    expect(() => parseBuildArchiveArgs([])).toThrow(/through is required/i);
  });
});

describe("M8-5b resolve session classification", () => {
  it("records deterministic exclusion reasons", () => {
    const root = mkdtempSync(join(tmpdir(), "m85b-reason-"));
    writeDriver(root, "2026-07-29");
    writeBounded(root, "2026-07-30");
    const candidate = discoverDriverCandidates(root)[0]!;
    const resolved = resolveRealArchiveSession({
      candidate,
      dataRoot: root,
      builtAt: "2026-08-01T00:00:00.000Z",
    });
    expect(resolved.classification).not.toBe("eligible");
    expect(resolved.exclusionReasons.length).toBeGreaterThan(0);
    expect(resolved.sourcesManifest.synthetic).toBe(false);
    expect(
      JSON.stringify(resolved.sourcesManifest),
    ).not.toMatch(/\/Users\//);
    rmSync(root, { recursive: true, force: true });
  });
});
