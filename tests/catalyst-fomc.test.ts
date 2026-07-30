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
  easternCalendarYear,
  fetchFomcCalendar,
  fetchOfficialCalendar,
  loadCatalystFeed,
  normalizeAndDedupe,
  parseFomcCalendarHtml,
  resolveFomcMeetingDates,
  zonedLocalToUtc,
} from "@/catalyst";
import { calendarLatestPath } from "@/catalyst/fetch-calendar";
import { Catalyst } from "@/contracts";

const FIXTURE = join(
  process.cwd(),
  "fixtures/catalyst/providers/fomc-sample.html",
);

function readFomcFixture(): string {
  return readFileSync(FIXTURE, "utf8");
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

function tempDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "gammadesk-m22b-"));
}

describe("FOMC date resolution", () => {
  it("handles same-month, SEP star, and Apr/May cross-month", () => {
    const jan = resolveFomcMeetingDates(2026, "January", "27-28");
    expect(jan.skip).toBe(false);
    expect(jan.endDate).toBe("2026-01-28");
    expect(jan.includesSep).toBe(false);

    const sep = resolveFomcMeetingDates(2026, "March", "17-18*");
    expect(sep.includesSep).toBe(true);
    expect(sep.endDate).toBe("2026-03-18");

    const cross = resolveFomcMeetingDates(2025, "Apr/May", "30-1");
    expect(cross.skip).toBe(false);
    expect(cross.startDate).toBe("2025-04-30");
    expect(cross.endDate).toBe("2025-05-01");
  });

  it("skips notation votes", () => {
    const n = resolveFomcMeetingDates(2025, "August", "22 (notation vote)");
    expect(n.skip).toBe(true);
  });
});

describe("FOMC HTML parser", () => {
  it("parses current and next year sections only", () => {
    const now = new Date("2026-08-01T15:00:00.000Z");
    expect(easternCalendarYear(now)).toBe(2026);

    const { meetings, rawEvents } = parseFomcCalendarHtml(readFomcFixture(), {
      now,
    });

    expect(meetings.every((m) => m.year === 2026 || m.year === 2027)).toBe(
      true,
    );
    expect(meetings.some((m) => m.year === 2025)).toBe(false);
    expect(meetings.some((m) => m.year === 2024)).toBe(false);

    // 2027 is next year → tentative note on events
    expect(meetings.filter((m) => m.year === 2027).every((m) => m.tentative)).toBe(
      true,
    );
    expect(
      rawEvents.some(
        (e) =>
          (e.externalId ?? "").includes("2027") &&
          (e.summary ?? "").toLowerCase().includes("tentative"),
      ),
    ).toBe(true);
  });

  it("maps SEP on policy decision only (not a duplicate SEP catalyst)", () => {
    const now = new Date("2026-02-01T12:00:00.000Z");
    const { meetings, rawEvents } = parseFomcCalendarHtml(readFomcFixture(), {
      now,
    });

    const mar = meetings.find((m) => m.endDate === "2026-03-18");
    expect(mar?.includesSep).toBe(true);

    const decision = rawEvents.find(
      (e) => e.externalId === "fomc:policy-decision:2026-03-18",
    );
    const press = rawEvents.find(
      (e) => e.externalId === "fomc:press-conference:2026-03-18",
    );
    expect(decision?.headline).toMatch(/Summary of Economic Projections/i);
    expect(press?.headline).not.toMatch(/Summary of Economic Projections/i);

    const sepExtra = rawEvents.filter((e) =>
      (e.headline ?? "").toLowerCase().includes("sep scheduled release"),
    );
    expect(sepExtra).toHaveLength(0);
  });

  it("emits decision 2:00 p.m. ET and press 2:30 p.m. ET as UTC Z (EST/EDT)", () => {
    // 2026-01-28 is EST (UTC−5) → 19:00Z / 19:30Z
    const estDecision = zonedLocalToUtc(
      2026,
      1,
      28,
      14,
      0,
      0,
      "America/New_York",
    ).toISOString();
    expect(estDecision).toBe("2026-01-28T19:00:00.000Z");

    // 2026-03-18 is EDT (UTC−4) → 18:00Z / 18:30Z
    const edtDecision = zonedLocalToUtc(
      2026,
      3,
      18,
      14,
      0,
      0,
      "America/New_York",
    ).toISOString();
    expect(edtDecision).toBe("2026-03-18T18:00:00.000Z");

    const now = new Date("2026-02-01T12:00:00.000Z");
    const { rawEvents } = parseFomcCalendarHtml(readFomcFixture(), { now });
    expect(
      rawEvents.find((e) => e.externalId === "fomc:policy-decision:2026-01-28")
        ?.occurredAt,
    ).toBe("2026-01-28T19:00:00.000Z");
    expect(
      rawEvents.find(
        (e) => e.externalId === "fomc:press-conference:2026-01-28",
      )?.occurredAt,
    ).toBe("2026-01-28T19:30:00.000Z");
    expect(
      rawEvents.find((e) => e.externalId === "fomc:policy-decision:2026-03-18")
        ?.occurredAt,
    ).toBe("2026-03-18T18:00:00.000Z");
    expect(
      rawEvents.find(
        (e) => e.externalId === "fomc:press-conference:2026-03-18",
      )?.occurredAt,
    ).toBe("2026-03-18T18:30:00.000Z");

    // Cross-month end date May 1, 2025 (EDT)
    const now2025 = new Date("2025-04-01T12:00:00.000Z");
    const cross = parseFomcCalendarHtml(readFomcFixture(), { now: now2025 });
    expect(
      cross.rawEvents.find(
        (e) => e.externalId === "fomc:policy-decision:2025-05-01",
      )?.occurredAt,
    ).toBe("2025-05-01T18:00:00.000Z");
  });

  it("ignores historical statement/minutes links and notation votes", () => {
    const now = new Date("2025-06-01T12:00:00.000Z");
    const { meetings, rawEvents } = parseFomcCalendarHtml(readFomcFixture(), {
      now,
    });
    expect(meetings.some((m) => /notation/i.test(m.dateLabel))).toBe(false);
    expect(
      rawEvents.every((e) => (e.sourceUrl ?? "").includes("fomccalendars")),
    ).toBe(true);
    expect(
      rawEvents.some((e) => (e.sourceUrl ?? "").includes("fomcminutes")),
    ).toBe(false);
    expect(
      rawEvents.some((e) => (e.headline ?? "").toLowerCase().includes("minutes")),
    ).toBe(false);
  });

  it("normalizes to critical/high upcoming unclear with official_fomc_schedule evidence", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const { rawEvents } = parseFomcCalendarHtml(readFomcFixture(), { now });
    const { catalysts } = normalizeAndDedupe(rawEvents);

    const decision = catalysts.find((c) =>
      c.dedupeKey.includes("policy-decision"),
    );
    const press = catalysts.find((c) =>
      c.dedupeKey.includes("press-conference"),
    );
    expect(decision).toBeDefined();
    expect(press).toBeDefined();
    if (!decision || !press) return;

    Catalyst.parse(decision);
    expect(decision.category).toBe("monetary-policy");
    expect(decision.importance).toBe("critical");
    expect(decision.status).toBe("upcoming");
    expect(decision.direction).toBe("unclear");
    expect(decision.synthetic).toBe(false);
    expect(decision.affectedAssets).toEqual(
      expect.arrayContaining(["US2Y", "US10Y", "USD", "SPX", "GOLD"]),
    );
    expect(decision.macroChannels).toEqual(
      expect.arrayContaining([
        "fed_rates",
        "liquidity",
        "growth",
        "inflation",
      ]),
    );
    expect(decision.evidence[0]?.basis).toBe("official_fomc_schedule");
    expect(press.importance).toBe("high");
  });

  it("updates via same external identity (dedupe prefers newer observation)", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const first = parseFomcCalendarHtml(readFomcFixture(), {
      now,
      observedAt: "2026-08-01T12:00:00.000Z",
    }).rawEvents.find(
      (e) => e.externalId === "fomc:policy-decision:2026-08-12",
    )!;
    const updated = {
      ...first,
      observedAt: "2026-08-10T12:00:00.000Z",
      headline: "FOMC policy decision (scheduled; date confirmed)",
      evidenceStatements: ["Updated official schedule observation"],
    };
    const { catalysts, droppedDuplicates } = normalizeAndDedupe([
      first,
      updated,
    ]);
    expect(droppedDuplicates).toBe(1);
    expect(catalysts).toHaveLength(1);
    expect(catalysts[0]?.headline).toMatch(/date confirmed/);
    expect(catalysts[0]?.observedAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("rejects malformed or structure-changed HTML", () => {
    expect(() => parseFomcCalendarHtml("<html><body>no meetings</body></html>")).toThrow(
      /missing expected|no meetings/i,
    );
    expect(() =>
      parseFomcCalendarHtml(
        `<div class="panel panel-default"><h4>2026 FOMC Meetings</h4><div class="row">no classes</div></div>`,
        { now: new Date("2026-01-01T00:00:00Z") },
      ),
    ).toThrow(/no meetings parsed/i);
  });
});

describe("FOMC fetch adapter + three-provider merge", () => {
  const blsOk = () =>
    mockResponse(
      readFileSync(
        join(process.cwd(), "fixtures/catalyst/providers/bls-sample.ics"),
        "utf8",
      ),
      "text/calendar",
    );
  const beaOk = () =>
    mockResponse(
      readFileSync(
        join(process.cwd(), "fixtures/catalyst/providers/bea-sample.json"),
        "utf8",
      ),
      "application/json",
    );
  const fomcOk = () => mockResponse(readFomcFixture(), "text/html; charset=utf-8");

  function routeFetch(url: string): Response {
    if (url.includes("bls.gov")) return blsOk();
    if (url.includes("bea.gov")) return beaOk();
    if (url.includes("federalreserve.gov")) return fomcOk();
    return mockResponse("missing", "text/plain", 404);
  }

  it("fetches FOMC with content-type validation", async () => {
    const ok = await fetchFomcCalendar({
      now: new Date("2026-08-01T12:00:00.000Z"),
      fetchImpl: async () => fomcOk(),
    });
    expect(ok.source.status).toBe("ok");
    expect(ok.source.id).toBe("federal_reserve");
    expect(ok.rawEvents.length).toBeGreaterThan(0);

    const bad = await fetchFomcCalendar({
      fetchImpl: async () => mockResponse("{}", "application/json"),
    });
    expect(bad.source.status).toBe("error");
    expect(bad.source.error).toMatch(/content-type/i);
  });

  it("records three-provider success, partial, and all-fail", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const root = tempDataRoot();

    const allOk = await fetchOfficialCalendar({
      now,
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => routeFetch(url),
    });
    expect(allOk.cache.sources).toHaveLength(3);
    expect(allOk.cache.partialFailure).toBe(false);
    expect(allOk.cache.sources.every((s) => s.status === "ok")).toBe(true);
    expect(
      allOk.cache.catalysts.some((c) =>
        c.sourceName.includes("Federal Reserve"),
      ),
    ).toBe(true);
    // Aug 12 FOMC is inside now=2026-08-01 window; decision 2pm + press 2:30pm ET
    const aug12 = allOk.cache.catalysts.filter(
      (c) =>
        c.sourceName.includes("Federal Reserve") &&
        c.occurredAt.startsWith("2026-08-12"),
    );
    expect(aug12.length).toBe(2);
    expect(
      aug12.every((c) => c.status === "upcoming" && c.direction === "unclear"),
    ).toBe(true);
    expect(aug12.map((c) => c.occurredAt).sort()).toEqual([
      "2026-08-12T18:00:00.000Z",
      "2026-08-12T18:30:00.000Z",
    ]);

    const partialRoot = tempDataRoot();
    const partial = await fetchOfficialCalendar({
      now,
      dataRoot: partialRoot,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => {
        if (url.includes("bls.gov")) {
          return mockResponse("denied", "text/html", 403);
        }
        if (url.includes("bea.gov")) return beaOk();
        return fomcOk();
      },
    });
    expect(partial.cache.partialFailure).toBe(true);
    expect(partial.cache.sources.find((s) => s.id === "bls")?.status).toBe(
      "error",
    );
    expect(
      partial.cache.sources.find((s) => s.id === "federal_reserve")?.status,
    ).toBe("ok");
    expect(partial.path).not.toBeNull();

    const failRoot = tempDataRoot();
    const path = calendarLatestPath(failRoot);
    mkdirSync(join(failRoot, "catalyst"), { recursive: true });
    writeFileSync(path, JSON.stringify({ keep: true }));
    const allFail = await fetchOfficialCalendar({
      now,
      dataRoot: failRoot,
      write: true,
      publicDemo: false,
      fetchImpl: async () => mockResponse("nope", "text/plain", 500),
    });
    expect(allFail.path).toBeNull();
    expect(allFail.cache.sources).toHaveLength(3);
    expect(allFail.cache.sources.every((s) => s.status === "error")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ keep: true });
    expect(existsSync(path)).toBe(true);
  });

  it("keeps FOMC rows inside the default window via injected now", async () => {
    const root = tempDataRoot();
    // Window from 2026-08-01: includes Aug 12 FOMC, excludes Jan 2026 and Sep 16
    // (Sep 16 is past now+45d = Sep 15 12:00Z).
    const result = await fetchOfficialCalendar({
      now: new Date("2026-08-01T12:00:00.000Z"),
      dataRoot: root,
      write: true,
      publicDemo: false,
      fetchImpl: async (url) => routeFetch(url),
    });
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
    expect(
      result.cache.catalysts.some((c) =>
        c.dedupeKey.includes("2026-09-16"),
      ),
    ).toBe(false);
  });

  it("public demo never calls Federal Reserve", async () => {
    const fetchImpl = vi.fn(async () => fomcOk());
    await expect(
      fetchOfficialCalendar({ publicDemo: true, fetchImpl }),
    ).rejects.toThrow(/public demo/i);
    expect(fetchImpl).not.toHaveBeenCalled();

    const feed = loadCatalystFeed({}, { publicDemo: true });
    expect(feed.mode).toBe("synthetic_demo");
    expect(feed.source.type).toBe("fixture");
  });
});
