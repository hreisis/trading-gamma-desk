import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildReleasesFromSeries,
  compareReferencePeriod,
  compareSourcePeriod,
  fetchOfficialResults,
  linkReleasesToCatalysts,
  loadCatalystFeed,
  materializeResultsFeed,
  momPercentChange,
  normalizeAndDedupe,
  parseBlsApiTimeseriesBody,
  parseBlsIcs,
  parseBlsYearPeriod,
  parseReferencePeriodFromScheduleText,
  payrollMonthlyChangeThousands,
  resultsLatestPath,
  yoyPercentChange,
} from "@/catalyst";
import { calendarLatestPath } from "@/catalyst/fetch-calendar";
import { writeJsonAtomic } from "@/desk/atomic-write";
import type { BuiltRelease, Catalyst } from "@/catalyst";

const PROVIDERS = join(process.cwd(), "fixtures/catalyst/providers");

function readProvider(name: string): string {
  return readFileSync(join(PROVIDERS, name), "utf8");
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m22c1-"));
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

describe("BLS transforms", () => {
  it("computes CPI MoM/YoY with fixed precision", () => {
    expect(momPercentChange(332.568, 333.979)).toBe(-0.422);
    expect(yoyPercentChange(332.568, 322.892)).toBe(2.997);
    expect(momPercentChange(336.065, 336.121)).toBe(-0.017);
    expect(yoyPercentChange(336.065, 326)).toBe(3.087);
  });

  it("computes payroll monthly change in thousands", () => {
    expect(payrollMonthlyChangeThousands(158984, 158927)).toBe(57);
  });
});

describe("period metadata", () => {
  it("parses schedule reference periods and excludes guessing", () => {
    expect(
      parseReferencePeriodFromScheduleText(
        "The Consumer Price Index for July 2026.",
      ),
    ).toBe("2026-07");
    expect(parseReferencePeriodFromScheduleText("Employment Situation for July 2026")).toBe(
      "2026-07",
    );
    expect(parseReferencePeriodFromScheduleText("No month here")).toBeNull();
  });

  it("extracts referencePeriod from BLS ICS description", () => {
    const { rawEvents } = parseBlsIcs(readProvider("bls-sample.ics"));
    const cpi = rawEvents.find((e) => e.releaseFamily === "cpi");
    const nfp = rawEvents.find((e) => e.releaseFamily === "employment_situation");
    expect(cpi?.referencePeriod).toBe("2026-07");
    expect(nfp?.referencePeriod).toBe("2026-07");
  });
});

describe("BLS API parse + build", () => {
  it("validates payload, excludes M13, builds observations", () => {
    const parsed = parseBlsApiTimeseriesBody(readProvider("bls-api-sample.json"));
    expect(parsed.series).toHaveLength(4);
    const cpi = parsed.series.find((s) => s.seriesId === "CUSR0000SA0")!;
    expect(cpi.points.some((p) => p.sourcePeriod.endsWith("M13"))).toBe(false);
    expect(cpi.points.map((p) => p.referencePeriod)).toEqual([
      "2025-06",
      "2026-05",
      "2026-06",
    ]);

    const { releases } = buildReleasesFromSeries(
      parsed.series,
      "2026-07-15T12:00:00.000Z",
    );
    const juneCpi = releases.find(
      (r) => r.releaseFamily === "cpi" && r.referencePeriod === "2026-06",
    )!;
    expect(juneCpi.releaseResult.consensus).toBeNull();
    expect(juneCpi.releaseResult.surprise).toBeNull();
    expect(juneCpi.releaseResult.surpriseStatus).toBe("unavailable");

    const byMetric = Object.fromEntries(
      juneCpi.observations.map((o) => [o.metric, o.actual]),
    );
    expect(byMetric.headline_cpi_sa_mom).toBe(-0.422);
    expect(byMetric.headline_cpi_sa_yoy).toBe(2.997);
    expect(byMetric.core_cpi_sa_mom).toBe(-0.017);
    expect(byMetric.core_cpi_sa_yoy).toBe(3.087);

    const juneEmp = releases.find(
      (r) =>
        r.releaseFamily === "employment_situation" &&
        r.referencePeriod === "2026-06",
    )!;
    expect(
      juneEmp.observations.find((o) => o.metric === "total_nonfarm_payrolls_mom")
        ?.actual,
    ).toBe(57);
    expect(
      juneEmp.observations.find((o) => o.metric === "unemployment_rate")?.actual,
    ).toBe(4.2);
    expect(
      juneEmp.observations.find((o) => o.metric === "total_nonfarm_payrolls_mom")
        ?.preliminary,
    ).toBe(true);

    const mom = juneCpi.observations.find((o) => o.metric === "headline_cpi_sa_mom")!;
    expect(mom.inputs?.current).toEqual({
      sourcePeriod: "2026-M06",
      value: 332.568,
    });
    expect(mom.inputs?.previous).toEqual({
      sourcePeriod: "2026-M05",
      value: 333.979,
    });
    const yoy = juneCpi.observations.find((o) => o.metric === "headline_cpi_sa_yoy")!;
    expect(yoy.inputs?.yearAgo).toEqual({
      sourcePeriod: "2025-M06",
      value: 322.892,
    });
    const pay = juneEmp.observations.find(
      (o) => o.metric === "total_nonfarm_payrolls_mom",
    )!;
    expect(pay.inputs?.current.sourcePeriod).toBe("2026-M06");
    expect(pay.inputs?.previous?.sourcePeriod).toBe("2026-M05");
  });

  it("rejects malformed JSON / failed status", () => {
    expect(() => parseBlsApiTimeseriesBody("{")).toThrow(/not valid JSON/);
    expect(() =>
      parseBlsApiTimeseriesBody(
        JSON.stringify({ status: "REQUEST_FAILED", message: ["nope"] }),
      ),
    ).toThrow(/not succeeded/);
  });
});

describe("strict linking + revisions", () => {
  it("links scheduled→released on family+period and keeps identity", () => {
    const { catalysts } = normalizeAndDedupe(
      parseBlsIcs(readProvider("bls-sample.ics")).rawEvents,
    );
    const cpiSched = catalysts.find(
      (c) => c.releaseFamily === "cpi" && c.referencePeriod === "2026-07",
    )!;
    expect(cpiSched).toBeDefined();
    expect(cpiSched.status).toBe("upcoming");

    // Build a July release (fixture API only has June — fabricate link target)
    const { releases: juneReleases } = buildReleasesFromSeries(
      parseBlsApiTimeseriesBody(readProvider("bls-api-sample.json")).series,
      "2026-07-15T12:00:00.000Z",
    );
    const julyRelease = {
      ...juneReleases.find((r) => r.releaseFamily === "cpi")!,
      referencePeriod: "2026-07",
      releaseResult: {
        ...juneReleases.find((r) => r.releaseFamily === "cpi")!.releaseResult,
        referencePeriod: "2026-07",
      },
    };

    const linked = linkReleasesToCatalysts([cpiSched], [julyRelease]);
    expect(linked.linkedCount).toBe(1);
    expect(linked.catalysts[0]?.id).toBe(cpiSched.id);
    expect(linked.catalysts[0]?.status).toBe("released");
    expect(linked.catalysts[0]?.direction).toBe("unclear");
    expect(linked.catalysts[0]?.releaseResult?.consensus).toBeNull();
    expect(linked.catalysts[0]?.releaseResult?.surpriseStatus).toBe(
      "unavailable",
    );
  });

  it("warns on unmatched observation without superseding schedule rows", () => {
    const scheduled: Catalyst = {
      schemaVersion: "0.1.0",
      id: "cat_sched",
      occurredAt: "2026-08-12T12:30:00.000Z",
      observedAt: "2026-08-12T12:30:00.000Z",
      sourceType: "calendar",
      sourceName: "BLS News Release Schedule",
      sourceUrl: "https://www.bls.gov/cpi/",
      headline: "CPI scheduled",
      summary: "schedule",
      category: "inflation",
      importance: "high",
      status: "upcoming",
      affectedAssets: ["US10Y"],
      macroChannels: ["inflation"],
      direction: "unclear",
      confidence: {
        score: 50,
        calibrated: false,
        note: "classification clarity only — not a market direction probability",
      },
      evidence: [
        { id: "e1", statement: "sched", basis: "official_release_schedule" },
      ],
      dedupeKey: "ext:sched-cpi",
      synthetic: false,
      releaseFamily: "cpi",
      // No referencePeriod → cannot strict-link
    };

    const { releases } = buildReleasesFromSeries(
      parseBlsApiTimeseriesBody(readProvider("bls-api-sample.json")).series,
      "2026-07-15T12:00:00.000Z",
    );
    const linked = linkReleasesToCatalysts([scheduled], releases);
    expect(linked.catalysts.find((c) => c.id === "cat_sched")?.status).toBe(
      "upcoming",
    );
    expect(linked.unmatchedReleaseCount).toBeGreaterThanOrEqual(1);
    expect(linked.linkingWarnings.length).toBeGreaterThanOrEqual(1);
    expect(
      linked.catalysts.some((c) =>
        c.headline.includes("independent observation"),
      ),
    ).toBe(true);
    expect(linked.linkingWarnings.every((w) => w.releaseFamily && w.referencePeriod)).toBe(
      true,
    );
    // At most one warning/standalone per family — not one per historical period.
    expect(linked.materializedStandaloneCount).toBeLessThanOrEqual(2);
    expect(linked.archiveReleaseCount).toBe(releases.length);
  });
});

describe("results fetch cache", () => {
  it("writes cache, revises same period, preserves on all-fail, idempotent", async () => {
    const root = tempRoot();
    const now = new Date("2026-07-15T12:00:00.000Z");

    // Plant a calendar cache so linking diagnostics run.
    const { catalysts } = normalizeAndDedupe(
      parseBlsIcs(readProvider("bls-sample.ics")).rawEvents,
    );
    writeJsonAtomic(calendarLatestPath(root), {
      kind: "CatalystCalendarCache",
      schemaVersion: "0.1.0",
      fetchedAt: now.toISOString(),
      requestedWindow: {
        now: now.toISOString(),
        start: now.toISOString(),
        end: now.toISOString(),
      },
      sources: [],
      catalysts,
      validationErrors: [],
      partialFailure: false,
    });

    const first = await fetchOfficialResults({
      now,
      dataRoot: root,
      calendarDataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async () =>
        mockResponse(readProvider("bls-api-sample.json"), "text/plain"),
    });
    expect(first.path).toBe(resultsLatestPath(root));
    expect(existsSync(first.path!)).toBe(true);
    expect(first.cache.releases.length).toBeGreaterThan(0);

    // Idempotent re-fetch with identical payload → no new revisions
    const second = await fetchOfficialResults({
      now: new Date("2026-07-15T13:00:00.000Z"),
      dataRoot: root,
      calendarDataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async () =>
        mockResponse(readProvider("bls-api-sample.json"), "text/plain"),
    });
    expect(second.cache.revisions.filter((r) => r.observedAt.startsWith("2026-07-15T13"))).toHaveLength(
      0,
    );

    // Same period value change → revision recorded
    const revisedBody = JSON.parse(readProvider("bls-api-sample.json")) as {
      Results: { series: Array<{ seriesID: string; data: Array<{ value: string; period: string; year: string }> }> };
    };
    for (const s of revisedBody.Results.series) {
      if (s.seriesID === "CUSR0000SA0") {
        const june = s.data.find((d) => d.period === "M06" && d.year === "2026");
        if (june) june.value = "333.000";
      }
    }
    const third = await fetchOfficialResults({
      now: new Date("2026-07-16T12:00:00.000Z"),
      dataRoot: root,
      calendarDataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async () =>
        mockResponse(JSON.stringify(revisedBody), "application/json"),
    });
    expect(
      third.cache.revisions.some(
        (r) => r.releaseFamily === "cpi" && r.referencePeriod === "2026-06",
      ),
    ).toBe(true);

    // All-fail must not overwrite
    const path = resultsLatestPath(root);
    const before = readFileSync(path, "utf8");
    const failed = await fetchOfficialResults({
      now: new Date("2026-07-17T12:00:00.000Z"),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async () => mockResponse("nope", "text/html", 403),
    });
    expect(failed.path).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("public demo never calls BLS results API", async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse(readProvider("bls-api-sample.json"), "text/plain"),
    );
    await expect(
      fetchOfficialResults({ publicDemo: true, fetchImpl }),
    ).rejects.toThrow(/public demo/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("API/UI feed with synthetic results", () => {
  it("attaches synthetic release results without inventing consensus", () => {
    const feed = loadCatalystFeed({}, { publicDemo: true });
    const cpi = feed.catalysts.find((c) => c.releaseFamily === "cpi");
    expect(cpi?.releaseResult).toBeDefined();
    expect(cpi?.releaseResult?.consensus).toBeNull();
    expect(cpi?.releaseResult?.surprise).toBeNull();
    expect(cpi?.releaseResult?.surpriseStatus).toBe("unavailable");
    expect(cpi?.releaseResult?.observations.length).toBeGreaterThan(0);
    expect(feed.source.results?.status).toBe("synthetic");
    expect(JSON.stringify(feed).toLowerCase()).not.toContain("beat");
    expect(JSON.stringify(feed).toLowerCase()).not.toContain("bullish");
  });
});

describe("M2-2C1 hardening: archive vs feed materialization", () => {
  function makeArchive(countPerFamily: number): BuiltRelease[] {
    const base = buildReleasesFromSeries(
      parseBlsApiTimeseriesBody(readProvider("bls-api-sample.json")).series,
      "2026-07-15T12:00:00.000Z",
    ).releases;
    const templateCpi = base.find((r) => r.releaseFamily === "cpi")!;
    const templateEmp = base.find(
      (r) => r.releaseFamily === "employment_situation",
    )!;
    const out: BuiltRelease[] = [];
    // 29 months each ≈ 58 total (matches live fetch scale).
    for (let i = 0; i < countPerFamily; i += 1) {
      const year = 2024 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      const period = `${year}-${String(month).padStart(2, "0")}`;
      for (const tmpl of [templateCpi, templateEmp]) {
        out.push({
          ...tmpl,
          referencePeriod: period,
          releaseResult: {
            ...tmpl.releaseResult,
            referencePeriod: period,
          },
        });
      }
    }
    return out;
  }

  it("does not turn 58 historical result records into 58 default feed items", () => {
    const archive = makeArchive(29);
    expect(archive.length).toBe(58);

    const mat = materializeResultsFeed({
      scheduled: [],
      releases: archive,
      calendarAvailable: false,
      calendarUnavailableReason: "BLS calendar cache missing",
    });

    expect(mat.archiveReleaseCount).toBe(58);
    expect(mat.materializedStandaloneCount).toBe(2);
    expect(mat.catalysts).toHaveLength(2);
    expect(mat.linkingWarnings).toHaveLength(2);
    expect(
      mat.linkingWarnings.every(
        (w) =>
          w.reason === "calendar_unavailable" &&
          w.releaseFamily &&
          w.referencePeriod,
      ),
    ).toBe(true);
    // Latest periods only (2026-05 from index 29*… 2024-01 + 28 months = 2026-05)
    expect(
      mat.catalysts.every((c) => c.referencePeriod === "2026-05"),
    ).toBe(true);
  });

  it("merges stably when calendar recovers for same family + period", () => {
    const archive = makeArchive(29);
    const latestPeriod = "2026-05";

    const withoutCal = materializeResultsFeed({
      scheduled: [],
      releases: archive,
      calendarAvailable: false,
      calendarUnavailableReason: "missing calendar",
    });
    const standaloneId = withoutCal.catalysts.find(
      (c) => c.releaseFamily === "cpi",
    )?.id;
    expect(standaloneId).toMatch(/^cat_/);

    const scheduled: Catalyst = {
      schemaVersion: "0.1.0",
      id: "cat_sched_cpi_stable",
      occurredAt: "2026-06-11T12:30:00.000Z",
      observedAt: "2026-06-11T12:30:00.000Z",
      sourceType: "calendar",
      sourceName: "BLS News Release Schedule",
      sourceUrl: "https://www.bls.gov/cpi/",
      headline: "Consumer Price Index (CPI) scheduled release",
      summary: "schedule",
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
        { id: "e1", statement: "sched", basis: "official_release_schedule" },
      ],
      dedupeKey: "ext:bls-cpi-sched-2026-05",
      synthetic: false,
      releaseFamily: "cpi",
      referencePeriod: latestPeriod,
    };

    const withCal = materializeResultsFeed({
      scheduled: [scheduled],
      releases: archive,
      calendarAvailable: true,
    });

    const cpiRows = withCal.catalysts.filter((c) => c.releaseFamily === "cpi");
    expect(cpiRows).toHaveLength(1);
    expect(cpiRows[0]?.id).toBe("cat_sched_cpi_stable");
    expect(cpiRows[0]?.status).toBe("released");
    expect(cpiRows.some((c) => c.id === standaloneId)).toBe(false);
    expect(withCal.linkingWarnings.some((w) => w.releaseFamily === "cpi")).toBe(
      false,
    );
  });

  it("orders BLS periods numerically (M09 < M10, cross-year, unordered, dedupe, M13)", () => {
    expect(compareSourcePeriod("2025-M09", "2025-M10")).toBeLessThan(0);
    expect(compareReferencePeriod("2025-12", "2026-01")).toBeLessThan(0);
    expect(parseBlsYearPeriod("2025", "M13")).toBeNull();

    const disordered = {
      status: "REQUEST_SUCCEEDED",
      Results: {
        series: [
          {
            seriesID: "LNS14000000",
            data: [
              { year: "2025", period: "M10", value: "4.1", footnotes: [{}] },
              { year: "2025", period: "M09", value: "4.0", footnotes: [{}] },
              { year: "2025", period: "M13", value: "4.2", footnotes: [{}] },
              { year: "2025", period: "M09", value: "4.05", footnotes: [{}] },
              { year: "2026", period: "M01", value: "4.3", footnotes: [{}] },
            ],
          },
        ],
      },
    };
    const parsed = parseBlsApiTimeseriesBody(JSON.stringify(disordered));
    const periods = parsed.series[0]!.points.map((p) => p.sourcePeriod);
    expect(periods).toEqual(["2025-M09", "2025-M10", "2026-M01"]);
    // Duplicate M09 kept last value
    expect(parsed.series[0]!.points[0]!.value).toBe(4.05);
  });

  it("surfaces results-only feed when calendar cache is missing", () => {
    const root = tempRoot();
    const now = new Date("2026-07-15T12:00:00.000Z");
    const archive = makeArchive(29);
    writeJsonAtomic(resultsLatestPath(root), {
      kind: "CatalystResultsCache",
      schemaVersion: "0.1.0",
      fetchedAt: now.toISOString(),
      sources: [
        {
          id: "bls_api",
          name: "BLS Public Data API",
          url: "https://api.bls.gov/publicAPI/v1/timeseries/data/",
          status: "ok",
          seriesCount: 4,
        },
      ],
      seriesMetadata: [],
      releases: archive,
      revisions: [],
      validationErrors: [],
      linkingWarnings: [],
      partialFailure: false,
    });

    const feed = loadCatalystFeed(
      {},
      { publicDemo: false, dataRoot: root, now },
    );
    expect(feed.mode).toBe("official_calendar");
    expect(feed.banner).toMatch(/calendar cache unavailable/i);
    expect(feed.catalysts.length).toBe(2);
    expect(feed.source.results?.archiveReleaseCount).toBe(58);
    expect(feed.source.results?.materializedStandaloneCount).toBe(2);
    expect(feed.catalysts.every((c) => c.direction === "unclear")).toBe(true);
    expect(feed.catalysts.every((c) => c.releaseResult?.consensus === null)).toBe(
      true,
    );
  });
});
