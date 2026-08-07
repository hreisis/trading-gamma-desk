import { loadCatalystFeed } from "@/catalyst/load";
import { CALENDAR_STALE_AFTER_MS } from "@/catalyst/cache";
import { classifyEventSession } from "@/catalyst/market-context/session";
import {
  resolveAiStudyMarketStatus,
  resolveCurrentMarketSessionDate,
} from "@/ai-study/session";
import { buildEventGate } from "@/desk/event-gate/build-event-gate";
import { classifyHighImpactEvent } from "@/desk/event-gate/classify";
import { loadMarketInputSnapshot } from "@/desk/build-market-input-snapshot";
import { sessionDateFromIso } from "@/gamma/marketdata-app/time";
import { defaultSessionCalendar } from "@/macro/calendar";

const now = new Date();
const generatedAt = now.toISOString();
const target = resolveCurrentMarketSessionDate(now);

const feed = loadCatalystFeed({}, { publicDemo: false, now });
const gate = buildEventGate({
  feed,
  targetMarketSessionDate: target,
  generatedAt,
  publicDemo: false,
});

const highImpact = (feed?.catalysts ?? [])
  .map((c) => ({ c, kind: classifyHighImpactEvent(c) }))
  .filter((x) => x.kind)
  .sort((a, b) => Date.parse(a.c.occurredAt) - Date.parse(b.c.occurredAt));

const nearestFuture = highImpact.find(
  (x) => Date.parse(x.c.occurredAt) >= now.getTime(),
);
const nearestPast = [...highImpact]
  .reverse()
  .find((x) => Date.parse(x.c.occurredAt) < now.getTime());

const sessionAudit = [
  "2026-08-07T21:00:00-04:00",
  "2026-08-08T12:00:00-04:00",
  "2026-08-09T12:00:00-04:00",
  "2026-08-10T08:00:00-04:00",
  "2026-07-03T12:00:00-04:00",
].map((iso) => {
  const d = new Date(iso);
  const resolved = resolveCurrentMarketSessionDate(d);
  const ctx = classifyEventSession(d);
  return {
    iso,
    resolveCurrentMarketSessionDate: resolved,
    isTradingSession: defaultSessionCalendar.isSession(resolved),
    isWeekend: ctx.isWeekend,
    isHoliday: ctx.isHoliday,
    marketStatus: resolveAiStudyMarketStatus(d),
  };
});

console.log(
  JSON.stringify(
    {
      liveSmoke: {
        now: generatedAt,
        targetMarketSessionDate: target,
        isTargetTradingSession: defaultSessionCalendar.isSession(target),
        marketStatus: resolveAiStudyMarketStatus(now),
        feedMode: feed?.mode,
        feedGeneratedAt: feed?.generatedAt,
        fetchedAt: feed?.source?.fetchedAt,
        fetchedAtSessionET: feed?.source?.fetchedAt
          ? sessionDateFromIso(feed.source.fetchedAt)
          : null,
        staleFlag: feed?.source?.stale,
        ageMs: feed?.source?.fetchedAt
          ? now.getTime() - Date.parse(feed.source.fetchedAt)
          : null,
        staleAfterMs: CALENDAR_STALE_AFTER_MS,
        crossSessionMismatch: feed?.source?.fetchedAt
          ? sessionDateFromIso(feed.source.fetchedAt) !== target
          : null,
        catalystCount: feed?.count,
        highImpactCount: highImpact.length,
        gate: {
          state: gate.state,
          status: gate.status,
          stale: gate.stale,
          missingReason: gate.missingReason,
          activeEvents: gate.activeEvents.map((e) => ({
            kind: e.kind,
            phase: e.phase,
            occurredAt: e.occurredAt,
            headline: e.headline,
          })),
          nextEvent: gate.nextEvent
            ? {
                kind: gate.nextEvent.kind,
                headline: gate.nextEvent.headline,
                occurredAt: gate.nextEvent.occurredAt,
              }
            : null,
        },
        nearestFuture: nearestFuture
          ? {
              kind: nearestFuture.kind,
              headline: nearestFuture.c.headline,
              occurredAt: nearestFuture.c.occurredAt,
            }
          : null,
        nearestPast: nearestPast
          ? {
              kind: nearestPast.kind,
              headline: nearestPast.c.headline,
              occurredAt: nearestPast.c.occurredAt,
            }
          : null,
        highImpactSample: highImpact.slice(0, 8).map((x) => ({
          kind: x.kind,
          headline: x.c.headline,
          occurredAt: x.c.occurredAt,
        })),
      },
      sessionAudit,
    },
    null,
    2,
  ),
);

loadMarketInputSnapshot({ publicDemo: false, now }).then((snap) => {
  const eg = snap.inputs.find((i) => i.key === "event_gate");
  console.log(
    JSON.stringify(
      {
        eventGateField: {
          status: eg?.status,
          stale: eg?.stale,
          missingReason: eg?.missingReason,
          valueState: (eg?.value as { state?: string } | null)?.state,
        },
      },
      null,
      2,
    ),
  );
});
