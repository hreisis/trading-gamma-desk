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
  CATALYST_DEMO_BANNER,
  CATALYST_OFFICIAL_BANNER,
  CATALYST_STALE_BANNER,
  CATALYST_UNAVAILABLE_BANNER,
  buildTimeWindow,
  fetchBeaCalendar,
  fetchBlsCalendar,
  fetchOfficialCalendar,
  isInTimeWindow,
  loadCalendarCache,
  loadCatalystFeed,
  matchOfficialEvent,
  normalizeAndDedupe,
  parseBeaReleaseDates,
  parseBlsIcs,
  parseIcsDateTimeToUtc,
  parseIcsEvents,
  unescapeIcsText,
  unfoldIcs,
  zonedLocalToUtc,
} from "@/catalyst";
import { calendarLatestPath } from "@/catalyst/fetch-calendar";

const FIXTURE_ROOT = join(
  process.cwd(),
  "fixtures/catalyst/providers",
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function tempDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m22a-"));
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

/** Route mocked fetch to the three official calendar providers. */
function mockOfficialProviders(url: string): Response {
  if (url.includes("bls.gov")) {
    return mockResponse(readFixture("bls-sample.ics"), "text/calendar");
  }
  if (url.includes("bea.gov")) {
    return mockResponse(readFixture("bea-sample.json"), "application/json");
  }
  if (url.includes("federalreserve.gov")) {
    return mockResponse(readFixture("fomc-sample.html"), "text/html");
  }
  return mockResponse("unexpected url", "text/plain", 404);
}

describe("ICS unfold / unescape / DTSTART", () => {
  it("unfolds continuation lines and unescapes text", () => {
    const folded = [
      "SUMMARY:Job Openings and Labor Turnover Su",
      " rvey",
      "DESCRIPTION:A\\, B\\; C\\\\D",
    ].join("\n");
    const lines = unfoldIcs(folded);
    expect(lines[0]).toBe("SUMMARY:Job Openings and Labor Turnover Survey");
    expect(unescapeIcsText("A\\, B\\; C\\\\D")).toBe("A, B; C\\D");
  });

  it("normalizes Eastern floating times and Zulu to UTC Z (DST-aware)", () => {
    // 2026-03-12 is after US spring forward — EDT (UTC−4).
    const dst = parseIcsDateTimeToUtc("20260312T083000", "");
    expect(dst).toBe("2026-03-12T12:30:00.000Z");

    // 2026-01-15 is EST (UTC−5).
    const standard = parseIcsDateTimeToUtc("20260115T083000", "");
    expect(standard).toBe("2026-01-15T13:30:00.000Z");

    const zulu = parseIcsDateTimeToUtc("20260813T123000Z", "");
    expect(zulu).toBe("2026-08-13T12:30:00.000Z");

    const ny = zonedLocalToUtc(2026, 8, 12, 8, 30, 0, "America/New_York");
    expect(ny.toISOString()).toBe("2026-08-12T12:30:00.000Z");
  });

  it("parses sample BLS ICS including folded JOLTS title", () => {
    const events = parseIcsEvents(readFixture("bls-sample.ics"));
    const summaries = events.map((e) => e.summary);
    expect(summaries).toContain("Job Openings and Labor Turnover Survey");
    expect(summaries).toContain("Consumer Price Index");
  });
});

describe("explicit event registry", () => {
  it("maps configured BLS/BEA titles and excludes irrelevant series", () => {
    expect(matchOfficialEvent("bls", "Consumer Price Index")?.id).toBe(
      "bls_cpi",
    );
    expect(matchOfficialEvent("bls", "Employment Situation")?.category).toBe(
      "labor",
    );
    expect(matchOfficialEvent("bls", "Productivity and Costs")).toBeNull();

    const pio = matchOfficialEvent("bea", "Personal Income and Outlays");
    expect(pio?.category).toBe("growth");
    expect(pio?.macroChannels).toEqual(
      expect.arrayContaining(["growth", "inflation", "fed_rates"]),
    );
    expect(pio?.summary.toLowerCase()).toContain("pce");

    expect(
      matchOfficialEvent("bea", "Travel and Tourism Satellite Account"),
    ).toBeNull();
  });

  it("maps BLS sample through parse → normalize with stable ids", () => {
    const { rawEvents, mappedEventCount } = parseBlsIcs(
      readFixture("bls-sample.ics"),
    );
    expect(mappedEventCount).toBeGreaterThanOrEqual(5);
    expect(
      rawEvents.every((r) => r.synthetic === false && r.rawStatus === "upcoming"),
    ).toBe(true);
    expect(
      rawEvents.some((r) => (r.headline ?? "").includes("Productivity")),
    ).toBe(false);

    const { catalysts, droppedDuplicates } = normalizeAndDedupe(rawEvents);
    expect(catalysts.length).toBeGreaterThan(0);
    expect(catalysts.every((c) => c.status === "upcoming")).toBe(true);
    expect(catalysts.every((c) => c.direction === "unclear")).toBe(true);
    expect(catalysts.every((c) => c.synthetic === false)).toBe(true);
    expect(catalysts.every((c) => c.id.startsWith("cat_"))).toBe(true);
    // Same title+uid should be stable across runs
    const again = normalizeAndDedupe(rawEvents).catalysts;
    expect(again.map((c) => c.id)).toEqual(catalysts.map((c) => c.id));
    expect(droppedDuplicates).toBeGreaterThanOrEqual(0);
  });

  it("validates BEA JSON and dedupes identical release timestamps", () => {
    const { rawEvents, mappedEventCount } = parseBeaReleaseDates(
      readFixture("bea-sample.json"),
    );
    expect(mappedEventCount).toBeGreaterThan(0);
    expect(
      rawEvents.some((r) => (r.headline ?? "").includes("Personal Income")),
    ).toBe(true);
    expect(
      rawEvents.some((r) => (r.headline ?? "").includes("Travel")),
    ).toBe(false);

    const { catalysts } = normalizeAndDedupe(rawEvents);
    const gdpAug = catalysts.filter(
      (c) =>
        c.headline.includes("GDP") && c.occurredAt.startsWith("2026-08-27"),
    );
    expect(gdpAug).toHaveLength(1);

    expect(() => parseBeaReleaseDates("{not-json")).toThrow(/not valid JSON/);
    expect(() => parseBeaReleaseDates("[]")).toThrow(/root must be an object/);
    expect(() =>
      parseBeaReleaseDates(
        JSON.stringify({ "Gross Domestic Product": { release_dates: "nope" } }),
      ),
    ).toThrow(/release_dates must be an array/);
    // Metadata string keys must not fail the whole file.
    expect(
      parseBeaReleaseDates(
        JSON.stringify({
          file_last_updated: "2026-07-13T08:00:42.402013",
          "Gross Domestic Product": {
            release_dates: ["2026-08-27T12:30:00+00:00"],
          },
        }),
      ).mappedEventCount,
    ).toBe(1);
  });
});

describe("deterministic time window", () => {
  it("uses injectable now and inclusive epoch bounds", () => {
    const now = new Date("2026-08-01T15:00:00.000Z");
    const window = buildTimeWindow(now);
    expect(window.start).toBe("2026-07-31T15:00:00.000Z");
    expect(window.end).toBe("2026-09-15T15:00:00.000Z");

    expect(isInTimeWindow("2026-07-31T15:00:00.000Z", window)).toBe(true);
    expect(isInTimeWindow("2026-09-15T15:00:00.000Z", window)).toBe(true);
    expect(isInTimeWindow("2026-07-31T14:59:59.999Z", window)).toBe(false);
    expect(isInTimeWindow("2026-09-15T15:00:00.001Z", window)).toBe(false);
  });
});

describe("provider fetch adapters (mocked network)", () => {
  it("accepts BLS calendar content-type and rejects HTML / timeout", async () => {
    const ics = readFixture("bls-sample.ics");
    const ok = await fetchBlsCalendar({
      fetchImpl: async () => mockResponse(ics, "text/calendar; charset=utf-8"),
    });
    expect(ok.source.status).toBe("ok");
    expect(ok.rawEvents.length).toBeGreaterThan(0);

    const html = await fetchBlsCalendar({
      fetchImpl: async () =>
        mockResponse(
          "<!DOCTYPE html><html>Access Denied</html>",
          "text/plain",
        ),
    });
    expect(html.source.status).toBe("error");
    expect(html.source.error).toMatch(/HTML|iCalendar/i);

    const timedOut = await fetchBlsCalendar({
      timeoutMs: 30,
      fetchImpl: async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
        throw new Error("unreachable");
      },
    });
    expect(timedOut.source.status).toBe("error");
    expect(timedOut.source.error).toMatch(/timed out/i);
  });

  it("accepts BEA JSON and reports invalid content type", async () => {
    const ok = await fetchBeaCalendar({
      fetchImpl: async () =>
        mockResponse(readFixture("bea-sample.json"), "application/json"),
    });
    expect(ok.source.status).toBe("ok");

    const bad = await fetchBeaCalendar({
      fetchImpl: async () => mockResponse("oops", "text/plain"),
    });
    expect(bad.source.status).toBe("error");
    expect(bad.source.error).toMatch(/content-type/i);
  });

  it("keeps partial success when one provider fails", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const root = tempDataRoot();
    const result = await fetchOfficialCalendar({
      now,
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => {
        if (url.includes("bls.gov")) {
          return mockResponse(
            "<!DOCTYPE html>denied",
            "text/html",
            403,
          );
        }
        return mockOfficialProviders(url);
      },
    });

    expect(result.cache.sources).toHaveLength(3);
    expect(result.cache.partialFailure).toBe(true);
    expect(
      result.cache.sources.find((s) => s.id === "bls")?.status,
    ).toBe("error");
    expect(
      result.cache.sources.find((s) => s.id === "bea")?.status,
    ).toBe("ok");
    expect(
      result.cache.sources.find((s) => s.id === "federal_reserve")?.status,
    ).toBe("ok");
    expect(result.cache.catalysts.length).toBeGreaterThan(0);
    expect(result.path).toBe(calendarLatestPath(root));
    expect(existsSync(result.path!)).toBe(true);
  });

  it("writes atomically and skips write when all providers fail", async () => {
    const root = tempDataRoot();
    const path = calendarLatestPath(root);
    mkdirSync(join(root, "catalyst"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ keep: true }),
    );

    const result = await fetchOfficialCalendar({
      now: new Date("2026-08-01T12:00:00.000Z"),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async () => mockResponse("nope", "text/plain", 500),
    });

    expect(result.path).toBeNull();
    expect(result.cache.sources).toHaveLength(3);
    expect(result.cache.catalysts).toHaveLength(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ keep: true });
  });

  it("refuses fetch under public demo (network isolation)", async () => {
    const fetchImpl = vi.fn(async () => mockResponse("{}", "application/json"));
    await expect(
      fetchOfficialCalendar({
        publicDemo: true,
        fetchImpl,
      }),
    ).rejects.toThrow(/public demo|Federal Reserve/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("local cache load + feed modes", () => {
  it("surfaces missing cache without synthetic fallback", () => {
    const root = tempDataRoot();
    const feed = loadCatalystFeed(
      {},
      { publicDemo: false, dataRoot: root, now: new Date("2026-08-01T00:00:00Z") },
    );
    expect(feed.mode).toBe("live_unavailable");
    expect(feed.banner).toBe(CATALYST_UNAVAILABLE_BANNER);
    expect(feed.catalysts).toHaveLength(0);
    expect(feed.source.synthetic).toBe(false);
    expect(feed.disclaimer).toMatch(/npm run catalyst:fetch/i);
  });

  it("loads official cache and marks stale by injected now", async () => {
    const root = tempDataRoot();
    const fetchedAt = "2026-08-01T12:00:00.000Z";
    await fetchOfficialCalendar({
      now: new Date(fetchedAt),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => mockOfficialProviders(url),
    });

    const fresh = loadCatalystFeed(
      {},
      {
        publicDemo: false,
        dataRoot: root,
        now: new Date("2026-08-01T13:00:00.000Z"),
      },
    );
    expect(fresh.mode).toBe("official_calendar");
    expect(fresh.banner).toContain("Official US macro calendar");
    expect(fresh.banner).toBe(CATALYST_OFFICIAL_BANNER);
    expect(fresh.source.fetchedAt).toBe(fetchedAt);
    expect(fresh.catalysts.every((c) => c.synthetic === false)).toBe(true);
    expect(fresh.catalysts.every((c) => c.status === "upcoming")).toBe(true);

    const stale = loadCatalystFeed(
      {},
      {
        publicDemo: false,
        dataRoot: root,
        now: new Date("2026-08-03T12:00:00.000Z"),
      },
    );
    expect(stale.mode).toBe("stale_calendar");
    expect(stale.banner).toContain(CATALYST_STALE_BANNER);
    expect(stale.source.stale).toBe(true);
    expect(stale.catalysts.length).toBeGreaterThan(0);

    const loaded = loadCalendarCache({
      dataRoot: root,
      now: new Date("2026-08-03T12:00:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.stale).toBe(true);
  });

  it("public demo always synthetic and never reads local cache", async () => {
    const root = tempDataRoot();
    await fetchOfficialCalendar({
      now: new Date("2026-08-01T12:00:00.000Z"),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => mockOfficialProviders(url),
    });

    const feed = loadCatalystFeed(
      {},
      { publicDemo: true, dataRoot: root },
    );
    expect(feed.mode).toBe("synthetic_demo");
    expect(feed.banner).toBe(CATALYST_DEMO_BANNER);
    expect(feed.source.synthetic).toBe(true);
    expect(feed.catalysts.every((c) => c.synthetic)).toBe(true);
    expect(feed.source.type).toBe("fixture");
  });

  it("window filter excludes out-of-range schedule rows at fetch time", async () => {
    const root = tempDataRoot();
    const result = await fetchOfficialCalendar({
      now: new Date("2026-08-01T12:00:00.000Z"),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => mockOfficialProviders(url),
    });

    // PPI on 2026-03-12 is outside Aug window
    expect(
      result.cache.catalysts.some((c) =>
        c.occurredAt.startsWith("2026-03-12"),
      ),
    ).toBe(false);
    // CPI Aug 12 is inside
    expect(
      result.cache.catalysts.some((c) =>
        c.headline.includes("CPI") && c.occurredAt.startsWith("2026-08-12"),
      ),
    ).toBe(true);
    // FOMC Aug 12 inside window; Jan 2026 outside
    expect(
      result.cache.catalysts.some((c) =>
        c.dedupeKey.includes("2026-08-12"),
      ),
    ).toBe(true);
    expect(
      result.cache.catalysts.some((c) =>
        c.dedupeKey.includes("2026-01-28"),
      ),
    ).toBe(false);
  });
});
