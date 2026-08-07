import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const EVENT_GATE_SCHEMA_VERSION = "0.1.0" as const;

export const EventGateState = z.enum([
  "clear",
  "scheduled_risk",
  "active_shock",
  "unavailable",
]);

export const EventGateEventKind = z.enum([
  "cpi",
  "payrolls",
  "fomc_decision",
  "fomc_press_conference",
]);

export const EventGatePhase = z.enum(["scheduled_risk", "active_shock"]);

export const EventGateActiveEvent = z.object({
  catalystId: z.string().min(1),
  kind: EventGateEventKind,
  headline: z.string().min(1),
  occurredAt: IsoDateTime,
  phase: EventGatePhase,
  windowStart: IsoDateTime,
  windowEnd: IsoDateTime,
});

export const EventGateSource = z.object({
  provider: z.string().min(1),
  artifact: z.string().min(1),
  fetchedAt: IsoDateTime.nullable(),
});

export const EventGateSnapshot = z.object({
  kind: z.literal("EventGate"),
  schemaVersion: z.literal(EVENT_GATE_SCHEMA_VERSION),
  state: EventGateState,
  asOf: IsoDateTime,
  marketSessionDate: IsoDate,
  activeEvents: z.array(EventGateActiveEvent),
  nextEvent: EventGateActiveEvent.nullable(),
  windowStart: IsoDateTime.nullable(),
  windowEnd: IsoDateTime.nullable(),
  source: EventGateSource,
  status: z.enum(["available", "partial", "unavailable"]),
  stale: z.boolean(),
  missingReason: z.string().nullable(),
});

export type EventGateState = z.infer<typeof EventGateState>;
export type EventGateEventKind = z.infer<typeof EventGateEventKind>;
export type EventGatePhase = z.infer<typeof EventGatePhase>;
export type EventGateActiveEvent = z.infer<typeof EventGateActiveEvent>;
export type EventGateSnapshot = z.infer<typeof EventGateSnapshot>;
