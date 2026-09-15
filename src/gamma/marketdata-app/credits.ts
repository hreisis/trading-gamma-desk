/**
 * MarketData.app daily API credits reset at 9:30 AM America/New_York (6:30 AM PT).
 * When exhausted (HTTP 429 / vendor credit-limit error), defer homepage gamma refresh
 * until the next reset and serve the latest persisted blob snapshot if present.
 */

import { sessionDateFromIso, sessionDateFromUnixSec } from "./time";

const ET = "America/New_York";
const RESET_HOUR = 9;
const RESET_MINUTE = 30;

const CREDIT_LIMIT_MESSAGE_RE =
  /credit limit|api credit|reached your.*credit|insufficient.*credit/i;

let deferGammaRefreshUntilMs: number | null = null;

function easternYmd(now: Date): string {
  return sessionDateFromUnixSec(Math.floor(now.getTime() / 1000));
}

function easternHourMinute(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

function offsetAtEasternNoon(ymd: string): string {
  for (const offset of ["-04:00", "-05:00"] as const) {
    const ms = Date.parse(`${ymd}T12:00:00${offset}`);
    if (!Number.isFinite(ms)) continue;
    if (sessionDateFromUnixSec(Math.floor(ms / 1000)) !== ymd) continue;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: ET,
        hour: "numeric",
        hour12: false,
      }).format(ms),
    );
    if (hour === 12) return offset;
  }
  return "-04:00";
}

function addCalendarDayYmd(ymd: string): string {
  const offset = offsetAtEasternNoon(ymd);
  return sessionDateFromIso(
    new Date(Date.parse(`${ymd}T12:00:00${offset}`) + 86_400_000).toISOString(),
  );
}

/** Next 9:30 AM ET credit reset at or after `now`. */
export function nextMarketDataCreditResetAt(now = new Date()): Date {
  const ymd = easternYmd(now);
  const { hour, minute } = easternHourMinute(now);
  const pastReset =
    hour > RESET_HOUR || (hour === RESET_HOUR && minute >= RESET_MINUTE);
  const targetYmd = pastReset ? addCalendarDayYmd(ymd) : ymd;
  const offset = offsetAtEasternNoon(targetYmd);
  return new Date(
    `${targetYmd}T${String(RESET_HOUR).padStart(2, "0")}:${String(RESET_MINUTE).padStart(2, "0")}:00${offset}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMarketDataCreditLimitExhausted(input: {
  readonly httpStatus?: number;
  readonly body?: unknown;
  readonly message?: string;
}): boolean {
  if (input.httpStatus === 429) return true;
  if (input.message && CREDIT_LIMIT_MESSAGE_RE.test(input.message)) return true;
  if (isRecord(input.body) && input.body.s === "error") {
    const errmsg =
      typeof input.body.errmsg === "string" ? input.body.errmsg : "";
    if (CREDIT_LIMIT_MESSAGE_RE.test(errmsg)) return true;
  }
  return false;
}

export function markMarketDataCreditsExhausted(now = new Date()): void {
  deferGammaRefreshUntilMs = nextMarketDataCreditResetAt(now).getTime();
}

/** Skip repeated MarketData gamma refresh attempts until the daily credit reset. */
export function shouldDeferMarketDataGammaRefresh(now = new Date()): boolean {
  if (deferGammaRefreshUntilMs === null) return false;
  if (now.getTime() >= deferGammaRefreshUntilMs) {
    deferGammaRefreshUntilMs = null;
    return false;
  }
  return true;
}

/** Test-only reset of in-process deferral state. */
export function resetMarketDataCreditDeferral(): void {
  deferGammaRefreshUntilMs = null;
}
