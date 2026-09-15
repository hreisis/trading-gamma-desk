import type { Catalyst } from "@/contracts";
import type { EventGateEventKind } from "@/contracts/event-gate";

/** Deterministic pre/post windows per high-impact event kind (wall-clock ms). */
export const EVENT_GATE_WINDOW_MS: Readonly<
  Record<EventGateEventKind, { readonly pre: number; readonly post: number }>
> = {
  cpi: { pre: 24 * 60 * 60 * 1000, post: 2 * 60 * 60 * 1000 },
  payrolls: { pre: 24 * 60 * 60 * 1000, post: 2 * 60 * 60 * 1000 },
  fomc_decision: { pre: 12 * 60 * 60 * 1000, post: 4 * 60 * 60 * 1000 },
  fomc_press_conference: { pre: 2 * 60 * 60 * 1000, post: 2 * 60 * 60 * 1000 },
};

/**
 * Latest unmatched BLS series prints are materialized onto the Catalyst feed
 * for display. Their `occurredAt` is the results-fetch clock, not a scheduled
 * release time — they must never open Event Gate.
 */
export function isIndependentSeriesObservation(catalyst: Catalyst): boolean {
  if (catalyst.dedupeKey.startsWith("ext:bls-result-")) return true;
  if (/\(independent observation\)/i.test(catalyst.headline)) return true;
  return catalyst.evidence.some((row) =>
    row.statement.startsWith("Independent BLS observation"),
  );
}

/**
 * Classify catalyst rows eligible for the shock gate.
 * FOMC press conference is checked before generic FOMC decision headlines.
 * Independent series observations are not scheduled events and are ignored.
 */
export function classifyHighImpactEvent(
  catalyst: Catalyst,
): EventGateEventKind | null {
  if (isIndependentSeriesObservation(catalyst)) return null;

  const headline = catalyst.headline.toLowerCase();

  if (
    headline.includes("press conference") ||
    headline.includes("chair press")
  ) {
    return "fomc_press_conference";
  }
  if (
    headline.includes("fomc policy decision") ||
    (headline.includes("policy decision") && headline.includes("fomc"))
  ) {
    return "fomc_decision";
  }
  if (
    catalyst.releaseFamily === "cpi" ||
    headline.includes("consumer price index") ||
    /\bcpi\b/.test(headline)
  ) {
    return "cpi";
  }
  if (
    catalyst.releaseFamily === "employment_situation" ||
    headline.includes("employment situation") ||
    headline.includes("payrolls") ||
    headline.includes("nonfarm")
  ) {
    return "payrolls";
  }
  return null;
}

export function eventGatePhaseAt(
  asOfMs: number,
  occurredMs: number,
  kind: EventGateEventKind,
): "scheduled_risk" | "active_shock" | null {
  const windows = EVENT_GATE_WINDOW_MS[kind];
  const preStart = occurredMs - windows.pre;
  const postEnd = occurredMs + windows.post;
  if (asOfMs >= preStart && asOfMs < occurredMs) return "scheduled_risk";
  if (asOfMs >= occurredMs && asOfMs <= postEnd) return "active_shock";
  return null;
}

export function eventGateWindowBounds(
  occurredMs: number,
  kind: EventGateEventKind,
): { readonly startMs: number; readonly endMs: number } {
  const windows = EVENT_GATE_WINDOW_MS[kind];
  return {
    startMs: occurredMs - windows.pre,
    endMs: occurredMs + windows.post,
  };
}
