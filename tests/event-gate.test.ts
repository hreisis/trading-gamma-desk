import { describe, expect, it } from "vitest";
import { normalizeCatalystEvent, loadCatalystFeed } from "@/catalyst";
import type { CatalystRawEvent } from "@/catalyst";
import type { CatalystFeedResponse } from "@/catalyst/types";
import { easternWallToUtc } from "@/catalyst/market-context/session";
import { Catalyst, statusCountTotal } from "@/contracts";
import {
  buildEventGate,
  buildMarketInputSnapshot,
  classifyHighImpactEvent,
  eventGatePhaseAt,
  loadBoundedGammaDeskView,
} from "@/desk";

const rawBase: CatalystRawEvent = {
  synthetic: false,
  externalId: "test-event",
  occurredAt: "2026-07-30T08:30:00-04:00",
  observedAt: "2026-07-29T12:00:00-04:00",
  sourceType: "calendar",
  sourceName: "BLS News Release Schedule",
  sourceUrl: "https://www.bls.gov/schedule/",
  headline: "Consumer Price Index (CPI) scheduled release",
  summary: "Scheduled time only — not an observed print.",
  rawCategory: "inflation",
  rawStatus: "upcoming",
  rawImportance: "high",
  rawDirection: "unclear",
  affectedAssets: ["US2Y", "US10Y"],
  macroChannels: ["inflation", "fed_rates"],
  evidenceStatements: ["Official schedule only"],
  evidenceBasis: "official_release_schedule",
  releaseFamily: "cpi",
};

function catalyst(overrides: Partial<CatalystRawEvent> & { externalId: string }): Catalyst {
  const result = normalizeCatalystEvent({ ...rawBase, ...overrides });
  if (!result.ok) throw new Error(result.error);
  return Catalyst.parse(result.catalyst);
}

function feed(
  catalysts: Catalyst[],
  overrides: Partial<CatalystFeedResponse> & { sessionDate?: string } = {},
): CatalystFeedResponse {
  const { sessionDate, ...feedOverrides } = overrides;
  const generatedAt =
    feedOverrides.generatedAt ??
    (sessionDate ? `${sessionDate}T12:00:00-04:00` : "2026-07-29T12:00:00-04:00");
  const fetchedAt =
    feedOverrides.source?.fetchedAt ??
    (sessionDate ? `${sessionDate}T12:00:00-04:00` : generatedAt);

  return {
    kind: "CatalystFeed",
    schemaVersion: "0.1.0",
    generatedAt,
    mode: feedOverrides.mode ?? "official_calendar",
    isPublicDemo: feedOverrides.isPublicDemo ?? false,
    banner: "test",
    disclaimer: "test",
    source: {
      type: feedOverrides.source?.synthetic ? "fixture" : "official_calendar",
      name: "official",
      synthetic: false,
      fetchedAt,
      ...feedOverrides.source,
    },
    count: catalysts.length,
    catalysts,
    validationErrors: [],
    ...feedOverrides,
  };
}

describe("classifyHighImpactEvent", () => {
  it("keeps FOMC decision and press conference distinct", () => {
    const decision = catalyst({
      externalId: "fomc-decision",
      headline: "FOMC policy decision (scheduled)",
      rawCategory: "fomc",
    });
    const press = catalyst({
      externalId: "fomc-press",
      headline: "Federal Reserve Chair press conference (scheduled)",
      rawCategory: "fomc",
      occurredAt: "2026-07-30T14:30:00-04:00",
    });
    expect(classifyHighImpactEvent(decision)).toBe("fomc_decision");
    expect(classifyHighImpactEvent(press)).toBe("fomc_press_conference");
  });
});

describe("buildEventGate", () => {
  it("returns clear when no high-impact events are inside risk windows", () => {
    const gate = buildEventGate({
      feed: feed([
        catalyst({
          externalId: "cpi-far",
          occurredAt: "2026-08-10T08:30:00-04:00",
        }),
      ]),
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T12:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("clear");
    expect(gate.activeEvents).toHaveLength(0);
    expect(gate.missingReason).toBeNull();
  });

  it("enters scheduled_risk before CPI", () => {
    const gate = buildEventGate({
      feed: feed([
        catalyst({
          externalId: "cpi-soon",
          occurredAt: "2026-07-30T08:30:00-04:00",
        }),
      ]),
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T20:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("scheduled_risk");
    expect(gate.activeEvents[0]?.kind).toBe("cpi");
    expect(gate.activeEvents[0]?.phase).toBe("scheduled_risk");
  });

  it("enters active_shock after CPI release within post window", () => {
    const gate = buildEventGate({
      feed: feed(
        [
        catalyst({
          externalId: "cpi-printed",
          occurredAt: "2026-07-15T08:30:00-04:00",
          rawStatus: "released",
        }),
      ],
        { sessionDate: "2026-07-15" },
      ),
      targetMarketSessionDate: "2026-07-15",
      generatedAt: "2026-07-15T09:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("active_shock");
    expect(gate.activeEvents[0]?.phase).toBe("active_shock");
  });

  it("tracks multiple same-day events without collapsing FOMC decision and press conference", () => {
    const gate = buildEventGate({
      feed: feed(
        [
        catalyst({
          externalId: "fomc-decision",
          headline: "FOMC policy decision (scheduled)",
          occurredAt: "2026-07-30T14:00:00-04:00",
          rawCategory: "fomc",
        }),
        catalyst({
          externalId: "fomc-press",
          headline: "Federal Reserve Chair press conference (scheduled)",
          occurredAt: "2026-07-30T14:30:00-04:00",
          rawCategory: "fomc",
        }),
      ],
        { sessionDate: "2026-07-30" },
      ),
      targetMarketSessionDate: "2026-07-30",
      generatedAt: "2026-07-30T13:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("scheduled_risk");
    expect(gate.activeEvents.map((e) => e.kind).sort()).toEqual([
      "fomc_decision",
      "fomc_press_conference",
    ]);
  });

  it("prefers active_shock over scheduled_risk when both phases are present", () => {
    const gate = buildEventGate({
      feed: feed(
        [
        catalyst({
          externalId: "payrolls-done",
          headline: "Employment Situation scheduled release",
          releaseFamily: "employment_situation",
          occurredAt: "2026-07-03T08:30:00-04:00",
        }),
        catalyst({
          externalId: "cpi-upcoming",
          occurredAt: "2026-07-04T08:30:00-04:00",
        }),
      ],
        { sessionDate: "2026-07-03" },
      ),
      targetMarketSessionDate: "2026-07-03",
      generatedAt: "2026-07-03T09:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("active_shock");
    expect(gate.activeEvents.some((e) => e.kind === "payrolls")).toBe(true);
    expect(gate.activeEvents.some((e) => e.kind === "cpi")).toBe(true);
  });

  it("returns unavailable for stale calendar", () => {
    const gate = buildEventGate({
      feed: feed([], { mode: "stale_calendar" }),
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T12:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("unavailable");
    expect(gate.stale).toBe(true);
    expect(gate.missingReason).toMatch(/stale/i);
  });

  it("returns unavailable when calendar feed is missing", () => {
    const gate = buildEventGate({
      feed: null,
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T12:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("unavailable");
  });

  it("stays available when fetchedAt is prior ET date but feed is still fresh", () => {
    const gate = buildEventGate({
      feed: feed(
        [
          catalyst({
            externalId: "cpi-far",
            occurredAt: "2026-08-10T08:30:00-04:00",
          }),
        ],
        {
          source: {
            type: "official_calendar",
            name: "official",
            synthetic: false,
            fetchedAt: "2026-08-02T22:00:00-04:00",
            stale: false,
          },
        },
      ),
      targetMarketSessionDate: "2026-08-03",
      generatedAt: "2026-08-03T08:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("clear");
    expect(gate.status).toBe("available");
    expect(gate.stale).toBe(false);
    expect(gate.missingReason).toBeNull();
  });

  it("returns unavailable when feed source.stale is true even if mode is official_calendar", () => {
    const gate = buildEventGate({
      feed: feed([], {
        mode: "official_calendar",
        source: {
          type: "official_calendar",
          name: "official",
          synthetic: false,
          fetchedAt: "2026-08-03T06:00:00-04:00",
          stale: true,
        },
      }),
      targetMarketSessionDate: "2026-08-03",
      generatedAt: "2026-08-03T08:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("unavailable");
    expect(gate.stale).toBe(true);
    expect(gate.missingReason).toMatch(/stale/i);
  });

  it("does not promote nextEvent into scheduled_risk when outside active windows", () => {
    const gate = buildEventGate({
      feed: feed([
        catalyst({
          externalId: "cpi-far",
          occurredAt: "2026-08-10T08:30:00-04:00",
        }),
      ]),
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T12:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("clear");
    expect(gate.nextEvent?.kind).toBe("cpi");
    expect(gate.activeEvents).toHaveLength(0);
  });

  it("returns clear after all configured windows have ended", () => {
    const gate = buildEventGate({
      feed: feed(
        [
          catalyst({
            externalId: "cpi-done",
            occurredAt: "2026-07-15T08:30:00-04:00",
            rawStatus: "released",
          }),
        ],
        { sessionDate: "2026-07-15" },
      ),
      targetMarketSessionDate: "2026-07-15",
      generatedAt: "2026-07-15T12:00:00-04:00",
      publicDemo: false,
    });
    expect(gate.state).toBe("clear");
    expect(gate.activeEvents).toHaveLength(0);
  });

  it("handles DST Eastern wall-clock for payrolls 08:30 ET", () => {
    const occurredAt = easternWallToUtc("2026-03-09", 8, 30).toISOString();
    const asOf = easternWallToUtc("2026-03-09", 9, 0).toISOString();
    const phase = eventGatePhaseAt(
      Date.parse(asOf),
      Date.parse(occurredAt),
      "payrolls",
    );
    expect(phase).toBe("active_shock");
  });
});

describe("real calendar-latest.json", () => {
  it("recognizes CPI, payrolls, FOMC decision, and press conference rows", () => {
    const now = new Date("2026-07-29T13:00:00-04:00");
    const feed = loadCatalystFeed({}, { publicDemo: false, now });
    expect(feed?.mode).toBe("official_calendar");

    const classified = (feed?.catalysts ?? [])
      .map((c) => ({ c, kind: classifyHighImpactEvent(c) }))
      .filter((row) => row.kind);

    const kinds = new Set(classified.map((row) => row.kind));
    expect(kinds.has("fomc_decision")).toBe(true);
    expect(kinds.has("fomc_press_conference")).toBe(true);
    expect(kinds.has("cpi")).toBe(true);
    expect(kinds.has("payrolls")).toBe(true);

    const decision = classified.find((row) => row.kind === "fomc_decision")?.c;
    const press = classified.find((row) => row.kind === "fomc_press_conference")?.c;
    expect(decision?.occurredAt).toBe("2026-07-29T18:00:00.000Z");
    expect(press?.occurredAt).toBe("2026-07-29T18:30:00.000Z");
    expect(decision?.id).not.toBe(press?.id);
  });

  it("builds a non-unavailable gate when cache is within freshness TTL", () => {
    const now = new Date("2026-07-30T12:00:00-04:00");
    const feed = loadCatalystFeed({}, { publicDemo: false, now });
    expect(feed?.source.stale).toBe(false);

    const gate = buildEventGate({
      feed,
      targetMarketSessionDate: "2026-07-30",
      generatedAt: now.toISOString(),
      publicDemo: false,
    });
    expect(gate.state).not.toBe("unavailable");
    expect(gate.missingReason).toBeNull();
  });
});

describe("MarketInputSnapshot event_gate integration", () => {
  it("keeps 14 keys and status totals when event gate is wired", () => {
    const snapshot = buildMarketInputSnapshot({
      targetMarketSessionDate: "2026-07-29",
      generatedAt: "2026-07-29T12:00:00-04:00",
      macro: null,
      alpacaPanel: null,
      catalystFeed: feed(
        [
          catalyst({
            externalId: "cpi-far",
            occurredAt: "2026-08-10T08:30:00-04:00",
          }),
        ],
        { sessionDate: "2026-07-29" },
      ),
      spyGamma: loadBoundedGammaDeskView({ forceFixture: true }),
      qqqGamma: loadBoundedGammaDeskView({ symbol: "QQQ", publicDemo: true }),
      publicDemo: false,
    });

    expect(snapshot.inputs).toHaveLength(14);
    expect(statusCountTotal(snapshot.summary)).toBe(14);
    const eventGate = snapshot.inputs.find((row) => row.key === "event_gate");
    expect(eventGate?.status).toBe("available");
    expect((eventGate?.value as { state: string }).state).toBe("clear");
  });
});
