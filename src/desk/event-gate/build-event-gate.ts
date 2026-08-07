import type { CatalystFeedResponse } from "@/catalyst/types";
import {
  EventGateSnapshot,
  EVENT_GATE_SCHEMA_VERSION,
  type EventGateActiveEvent,
  type EventGateState,
} from "@/contracts/event-gate";
import type { Catalyst } from "@/contracts";
import {
  classifyHighImpactEvent,
  eventGatePhaseAt,
  eventGateWindowBounds,
} from "./classify";

export interface BuildEventGateInput {
  readonly feed: CatalystFeedResponse | null;
  readonly targetMarketSessionDate: string;
  readonly generatedAt: string;
  readonly publicDemo: boolean;
}

function parseInstant(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function calendarFeedStale(feed: CatalystFeedResponse): boolean {
  return feed.mode === "stale_calendar" || feed.source.stale === true;
}

function sourceFromFeed(feed: CatalystFeedResponse | null): {
  provider: string;
  artifact: string;
  fetchedAt: string | null;
} {
  if (!feed) {
    return {
      provider: "catalyst",
      artifact: "data/catalyst/calendar-latest.json",
      fetchedAt: null,
    };
  }
  return {
    provider: feed.source.synthetic ? "synthetic_demo" : "official_calendar",
    artifact: feed.source.synthetic
      ? "fixtures/catalyst/synthetic-events.json"
      : "data/catalyst/calendar-latest.json",
    fetchedAt: feed.source.fetchedAt ?? feed.generatedAt,
  };
}

function unavailableGate(
  input: BuildEventGateInput,
  reason: string,
  stale: boolean,
): EventGateSnapshot {
  const source = sourceFromFeed(input.feed);
  return EventGateSnapshot.parse({
    kind: "EventGate",
    schemaVersion: EVENT_GATE_SCHEMA_VERSION,
    state: "unavailable",
    asOf: input.generatedAt,
    marketSessionDate: input.targetMarketSessionDate,
    activeEvents: [],
    nextEvent: null,
    windowStart: null,
    windowEnd: null,
    source,
    status: "unavailable",
    stale,
    missingReason: reason,
  });
}

function buildNextEvent(
  catalysts: readonly Catalyst[],
  asOfMs: number,
): EventGateActiveEvent | null {
  const upcoming = catalysts
    .map((catalyst) => {
      const kind = classifyHighImpactEvent(catalyst);
      const occurredMs = parseInstant(catalyst.occurredAt);
      if (!kind || occurredMs === null || occurredMs <= asOfMs) return null;
      const bounds = eventGateWindowBounds(occurredMs, kind);
      return {
        catalystId: catalyst.id,
        kind,
        headline: catalyst.headline,
        occurredAt: catalyst.occurredAt,
        phase: "scheduled_risk" as const,
        windowStart: toIso(bounds.startMs),
        windowEnd: toIso(bounds.endMs),
        occurredMs,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.occurredMs - b.occurredMs);

  const next = upcoming[0];
  if (!next) return null;
  const { occurredMs: _occurredMs, ...rest } = next;
  void _occurredMs;
  return rest;
}

export function buildEventGate(input: BuildEventGateInput): EventGateSnapshot {
  const asOfMs = parseInstant(input.generatedAt);
  if (asOfMs === null) {
    return unavailableGate(input, "generatedAt is not a valid ISO instant.", false);
  }

  if (!input.feed) {
    return unavailableGate(
      input,
      "Catalyst calendar feed was not loaded.",
      false,
    );
  }

  if (input.feed.mode === "live_unavailable") {
    return unavailableGate(
      input,
      "Official catalyst calendar cache unavailable.",
      false,
    );
  }

  if (calendarFeedStale(input.feed)) {
    return unavailableGate(
      input,
      "Catalyst calendar cache is stale — event gate withheld.",
      true,
    );
  }

  const activeEvents: EventGateActiveEvent[] = [];
  for (const catalyst of input.feed.catalysts) {
    const kind = classifyHighImpactEvent(catalyst);
    if (!kind) continue;
    const occurredMs = parseInstant(catalyst.occurredAt);
    if (occurredMs === null) continue;
    const phase = eventGatePhaseAt(asOfMs, occurredMs, kind);
    if (!phase) continue;
    const bounds = eventGateWindowBounds(occurredMs, kind);
    activeEvents.push({
      catalystId: catalyst.id,
      kind,
      headline: catalyst.headline,
      occurredAt: catalyst.occurredAt,
      phase,
      windowStart: toIso(bounds.startMs),
      windowEnd: toIso(bounds.endMs),
    });
  }

  activeEvents.sort((a, b) => {
    const byOccurred = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (byOccurred !== 0) return byOccurred;
    return a.catalystId.localeCompare(b.catalystId);
  });

  let state: EventGateState = "clear";
  if (activeEvents.some((event) => event.phase === "active_shock")) {
    state = "active_shock";
  } else if (activeEvents.some((event) => event.phase === "scheduled_risk")) {
    state = "scheduled_risk";
  }

  const windowStart =
    activeEvents.length > 0
      ? toIso(
          Math.min(...activeEvents.map((e) => Date.parse(e.windowStart))),
        )
      : null;
  const windowEnd =
    activeEvents.length > 0
      ? toIso(Math.max(...activeEvents.map((e) => Date.parse(e.windowEnd))))
      : null;

  const nextEvent = buildNextEvent(input.feed.catalysts, asOfMs);
  const source = sourceFromFeed(input.feed);
  const fieldStatus =
    input.feed.source.synthetic || input.publicDemo
      ? ("partial" as const)
      : ("available" as const);

  return EventGateSnapshot.parse({
    kind: "EventGate",
    schemaVersion: EVENT_GATE_SCHEMA_VERSION,
    state,
    asOf: input.generatedAt,
    marketSessionDate: input.targetMarketSessionDate,
    activeEvents,
    nextEvent,
    windowStart,
    windowEnd,
    source,
    status: fieldStatus,
    stale: false,
    missingReason: null,
  });
}
