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
  fetchOfficialResults,
  linkReleasesToCatalysts,
  loadCatalystFeed,
  momPercentChange,
  normalizeAndDedupe,
  parseBlsApiTimeseriesBody,
  parseBlsIcs,
  parseReferencePeriodFromScheduleText,
  payrollMonthlyChangeThousands,
  resultsLatestPath,
  yoyPercentChange,
} from "@/catalyst";
import { calendarLatestPath } from "@/catalyst/fetch-calendar";
import { writeJsonAtomic } from "@/desk/atomic-write";
import type { Catalyst } from "@/contracts";

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
      linked.catalysts.some((c) => c.headline.includes("unlinked observation")),
    ).toBe(true);
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
