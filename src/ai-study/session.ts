import {
  classifyEventSession,
  easternDateParts,
} from "@/catalyst/market-context/session";
import type { AiStudyMarketStatus } from "@/contracts/ai-study-briefing";
import { defaultSessionCalendar } from "@/macro/calendar";

export const AI_STUDY_TIMEZONE = "America/New_York" as const;

/** Calendar session date for the US equity desk in Eastern Time. */
export function resolveCurrentMarketSessionDate(now = new Date()): string {
  return easternDateParts(now).date;
}

/**
 * Last **completed** US equity session for daily cross-section inputs.
 * Before regular-session close ET on a trading day, returns the prior session
 * so intraday Alpaca daily bars are not treated as final.
 */
export function resolveLastCompletedMarketSessionDate(now = new Date()): string {
  const ctx = classifyEventSession(now);
  const calendar = defaultSessionCalendar;
  const easternDate = ctx.easternDate;

  if (!calendar.isSession(easternDate)) {
    return calendar.previousSession(easternDate) ?? easternDate;
  }

  if (
    ctx.regularSessionCloseUtc !== null &&
    now.getTime() < ctx.regularSessionCloseUtc.getTime()
  ) {
    return calendar.previousSession(easternDate) ?? easternDate;
  }

  return easternDate;
}

export function resolveAiStudyMarketStatus(now = new Date()): AiStudyMarketStatus {
  const ctx = classifyEventSession(now);
  if (ctx.isWeekend) return "weekend";
  if (ctx.isHoliday) return "holiday";
  if (ctx.eventInRegularSession) return "regular_session_open";
  if (ctx.eventInPremarket) return "premarket";
  if (
    ctx.regularSessionCloseUtc &&
    now.getTime() >= ctx.regularSessionCloseUtc.getTime()
  ) {
    return "after_hours";
  }
  return "closed";
}

export function isHistoricalAiStudySession(
  sessionDate: string | null | undefined,
): boolean {
  return typeof sessionDate === "string" && sessionDate.trim().length > 0;
}

export function formatAiStudyMarketStatus(status: AiStudyMarketStatus): string {
  switch (status) {
    case "regular_session_open":
      return "Regular session open";
    case "premarket":
      return "Premarket";
    case "after_hours":
      return "After hours";
    case "weekend":
      return "Weekend — market closed";
    case "holiday":
      return "Holiday — market closed";
    case "closed":
      return "Market closed";
  }
}
