/** Compact GEX formatting for desk UI (amplifier/compressor units — not a price). */

import { classifyEventSession } from "@/catalyst/market-context/session";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import type { BoundedGammaProviderSnapshot } from "@/contracts";
import type { DominantDriver } from "@/contracts";

export function formatGexCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatSpot(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function gammaRegimeLabel(
  regime: "positive" | "negative" | "near_zero" | "unavailable",
): string {
  switch (regime) {
    case "positive":
      return "Positive";
    case "negative":
      return "Negative";
    case "near_zero":
      return "Near zero";
    case "unavailable":
      return "Unavailable";
  }
}

export function gammaAvailabilityLabel(
  status: "available" | "incomplete" | "partial" | "unavailable",
): string {
  switch (status) {
    case "available":
      return "Available";
    case "incomplete":
      return "Incomplete";
    case "partial":
      return "Partial";
    case "unavailable":
      return "Unavailable";
  }
}

export function dteLabel(dte: number, zeroDteStatus: string): string {
  if (dte === 0 && zeroDteStatus !== "unavailable") {
    return "0DTE";
  }
  if (dte === 0) {
    return "0 DTE";
  }
  if (dte === 1) {
    return "1 DTE";
  }
  return `${dte} DTE`;
}

/** EOD session label — never implies live streaming quotes. */
export function formatOptionsDataCloseLabel(
  sessionDate: string | null,
  isFixture: boolean,
): string | null {
  if (!sessionDate) return null;
  const parts = sessionDate.split("-");
  if (parts.length !== 3) return `Options data · ${sessionDate} close`;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthLabel = monthNames[month - 1] ?? parts[1];
  const closeLabel = `Options data · ${monthLabel} ${day} close`;
  return isFixture ? `Fixture · ${monthLabel} ${day} close` : closeLabel;
}

export function dealerFlowRegimeLabel(
  regime: BoundedGammaProviderSnapshot["gammaRegime"],
): string | null {
  switch (regime) {
    case "positive":
      return "Stabilizing / mean-reverting dealer flow";
    case "negative":
      return "Amplifying / trend-following dealer flow";
    case "near_zero":
      return "Transition · dealer hedging near neutral";
    case "unavailable":
      return null;
  }
}

export function dealerFlowContextLines(input: {
  readonly spot: number | null;
  readonly callWall: number | null;
  readonly putWall: number | null;
  readonly flipStrike: number | null;
  readonly regime: BoundedGammaProviderSnapshot["gammaRegime"];
}): readonly string[] {
  if (input.spot === null || !Number.isFinite(input.spot)) {
    return [];
  }

  const lines: string[] = [];

  if (input.callWall !== null && input.spot > input.callWall) {
    lines.push("Above Call Wall → upside chase risk");
  }
  if (input.putWall !== null && input.spot < input.putWall) {
    lines.push("Below Put Wall → downside flush risk");
  }
  if (input.flipStrike !== null && input.spot < input.flipStrike) {
    lines.push("Below Gamma Flip → volatility expansion risk");
  }
  if (
    input.flipStrike !== null &&
    input.spot > input.flipStrike &&
    input.regime === "negative"
  ) {
    lines.push("Above Gamma Flip → trend amplification zone");
  }

  return lines;
}

/** Gamma flip strike from bounded snapshot when spot-shock model is available. */
export function readGammaFlipStrike(
  snapshot: BoundedGammaProviderSnapshot,
): number | null {
  const flip = snapshot.gammaFlip;
  if (flip.status === "unavailable" || flip.strike == null) {
    return null;
  }
  if (!Number.isFinite(flip.strike)) return null;
  return flip.strike;
}

export interface WallTouchProbability {
  readonly status: "available" | "unavailable";
  readonly percent: number | null;
}

const WALL_TOUCH_UNAVAILABLE: WallTouchProbability = {
  status: "unavailable",
  percent: null,
};

const DEFAULT_DAILY_VOL_PCT: Record<"SPY" | "QQQ", number> = {
  SPY: 0.011,
  QQQ: 0.013,
};

/** Fraction of the regular session still ahead (0 after close, 1 before open). */
export function remainingRegularSessionFraction(now: Date): number | null {
  const ctx = classifyEventSession(now);
  if (ctx.isWeekend || ctx.isHoliday) return null;
  if (ctx.regularSessionOpenUtc === null || ctx.regularSessionCloseUtc === null) {
    return null;
  }

  const open = ctx.regularSessionOpenUtc.getTime();
  const close = ctx.regularSessionCloseUtc.getTime();
  const sessionMs = close - open;
  if (sessionMs <= 0) return null;

  const nowMs = now.getTime();
  if (nowMs >= close) return 0;
  if (nowMs <= open) return 1;
  return (close - nowMs) / sessionMs;
}

function sessionSigmaMove(
  spot: number,
  dailyVolPct: number,
  remainingSessionFraction: number,
): number {
  if (remainingSessionFraction <= 0 || dailyVolPct <= 0) return 0;
  return spot * dailyVolPct * Math.sqrt(remainingSessionFraction);
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 + 0.3275911 * ax;
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function estimateOneSidedWallTouchPercent(input: {
  readonly spot: number;
  readonly wallStrike: number;
  readonly direction: "up" | "down";
  readonly dailyVolPct: number;
  readonly remainingSessionFraction: number;
}): number {
  const distance =
    input.direction === "up"
      ? input.wallStrike - input.spot
      : input.spot - input.wallStrike;

  if (distance <= 0) return 99;

  const remaining = input.remainingSessionFraction;
  if (remaining <= 0) return 0;

  const dailyVol = input.dailyVolPct;
  if (dailyVol <= 0) return 0;

  const sigmaMove = sessionSigmaMove(
    input.spot,
    dailyVol,
    input.remainingSessionFraction,
  );
  if (sigmaMove <= 0) return 0;

  const z = distance / sigmaMove;
  const touchProb = 2 * (1 - normalCdf(z));
  const percent = Math.round(touchProb * 100);
  return Math.min(99, Math.max(1, percent));
}

export function resolveWallTouchDailyVolPct(
  driver: DominantDriver | null,
  symbol: "SPY" | "QQQ",
): number {
  const vix = driver?.assets.find((asset) => asset.symbol === "VIX");
  if (
    vix?.value !== null &&
    vix?.value !== undefined &&
    Number.isFinite(vix.value) &&
    vix.value > 0
  ) {
    return vix.value / 100 / Math.sqrt(252);
  }
  return DEFAULT_DAILY_VOL_PCT[symbol];
}

/**
 * Model estimate for touching a bounded wall before the regular session close.
 * Not a vendor field or realized touch history.
 */
export function estimateWallTouchProbabilities(input: {
  readonly spot: number | null;
  readonly callWallStrike: number | null;
  readonly callWallAvailable: boolean;
  readonly putWallStrike: number | null;
  readonly putWallAvailable: boolean;
  readonly sessionDate: string;
  readonly symbol: "SPY" | "QQQ";
  readonly now: Date;
  readonly dailyVolPct: number;
}): {
  readonly callWallTouch: WallTouchProbability;
  readonly putWallTouch: WallTouchProbability;
} {
  if (input.spot === null || !Number.isFinite(input.spot) || input.spot <= 0) {
    return {
      callWallTouch: WALL_TOUCH_UNAVAILABLE,
      putWallTouch: WALL_TOUCH_UNAVAILABLE,
    };
  }

  const remaining = remainingRegularSessionFraction(input.now);
  if (remaining === null || remaining <= 0) {
    return {
      callWallTouch: WALL_TOUCH_UNAVAILABLE,
      putWallTouch: WALL_TOUCH_UNAVAILABLE,
    };
  }

  const targetSession = resolveLastCompletedMarketSessionDate(input.now);
  if (input.sessionDate !== targetSession) {
    return {
      callWallTouch: WALL_TOUCH_UNAVAILABLE,
      putWallTouch: WALL_TOUCH_UNAVAILABLE,
    };
  }

  const dailyVol = input.dailyVolPct;
  if (!Number.isFinite(dailyVol) || dailyVol <= 0) {
    return {
      callWallTouch: WALL_TOUCH_UNAVAILABLE,
      putWallTouch: WALL_TOUCH_UNAVAILABLE,
    };
  }

  const callWallTouch =
    input.callWallAvailable &&
    input.callWallStrike !== null &&
    Number.isFinite(input.callWallStrike)
      ? {
          status: "available" as const,
          percent: estimateOneSidedWallTouchPercent({
            spot: input.spot,
            wallStrike: input.callWallStrike,
            direction: "up",
            dailyVolPct: dailyVol,
            remainingSessionFraction: remaining,
          }),
        }
      : WALL_TOUCH_UNAVAILABLE;

  const putWallTouch =
    input.putWallAvailable &&
    input.putWallStrike !== null &&
    Number.isFinite(input.putWallStrike)
      ? {
          status: "available" as const,
          percent: estimateOneSidedWallTouchPercent({
            spot: input.spot,
            wallStrike: input.putWallStrike,
            direction: "down",
            dailyVolPct: dailyVol,
            remainingSessionFraction: remaining,
          }),
        }
      : WALL_TOUCH_UNAVAILABLE;

  return { callWallTouch, putWallTouch };
}

export function formatWallTouchLabel(touch: WallTouchProbability): string {
  if (touch.status !== "available" || touch.percent === null) {
    return "unavailable";
  }
  return `${touch.percent}%`;
}

export interface RestOfDayRange {
  readonly status: "available" | "unavailable";
  readonly lower: number | null;
  readonly upper: number | null;
  readonly confidencePct: number | null;
}

const REST_OF_DAY_UNAVAILABLE: RestOfDayRange = {
  status: "unavailable",
  lower: null,
  upper: null,
  confidencePct: null,
};

/** Two-sided normal z for a 90% rest-of-session range. */
const REST_OF_DAY_Z_90 = 1.6448536269514722;

function roundRestOfDayBound(value: number): number {
  if (value >= 100) return Math.round(value);
  return Math.round(value * 10) / 10;
}

/**
 * Model rest-of-session price range from spot, daily vol, and remaining session time.
 * Not a vendor forecast.
 */
export function estimateRestOfDayRange(input: {
  readonly spot: number | null;
  readonly dailyVolPct: number;
  readonly now: Date;
}): RestOfDayRange {
  if (input.spot === null || !Number.isFinite(input.spot) || input.spot <= 0) {
    return REST_OF_DAY_UNAVAILABLE;
  }

  const remaining = remainingRegularSessionFraction(input.now);
  if (remaining === null || remaining <= 0) {
    return REST_OF_DAY_UNAVAILABLE;
  }

  const dailyVol = input.dailyVolPct;
  if (!Number.isFinite(dailyVol) || dailyVol <= 0) {
    return REST_OF_DAY_UNAVAILABLE;
  }

  const sigmaMove = sessionSigmaMove(input.spot, dailyVol, remaining);
  if (sigmaMove <= 0) {
    return REST_OF_DAY_UNAVAILABLE;
  }

  const margin = REST_OF_DAY_Z_90 * sigmaMove;
  return {
    status: "available",
    lower: roundRestOfDayBound(input.spot - margin),
    upper: roundRestOfDayBound(input.spot + margin),
    confidencePct: 90,
  };
}

export function formatRestOfDayRangeLabel(range: RestOfDayRange): string {
  if (
    range.status !== "available" ||
    range.lower === null ||
    range.upper === null
  ) {
    return "unavailable";
  }
  const low =
    range.lower >= 1000
      ? range.lower.toLocaleString("en-US", { maximumFractionDigits: 1 })
      : String(range.lower);
  const high =
    range.upper >= 1000
      ? range.upper.toLocaleString("en-US", { maximumFractionDigits: 1 })
      : String(range.upper);
  return `${low}–${high}`;
}

export type VolMispricingSignal =
  | "vol_expensive"
  | "balanced"
  | "vol_underpriced";

export interface VolMispricingSummary {
  readonly status: "available" | "unavailable";
  readonly ivPct: number | null;
  readonly hv20Pct: number | null;
  readonly spreadVolPts: number | null;
  readonly signal: VolMispricingSignal | null;
  readonly ivDataLabel: string | null;
}

const VOL_MISPRICING_UNAVAILABLE: VolMispricingSummary = {
  status: "unavailable",
  ivPct: null,
  hv20Pct: null,
  spreadVolPts: null,
  signal: null,
  ivDataLabel: null,
};

/** IV minus HV in percentage points; positive means options look expensive vs HV20. */
const VOL_EXPENSIVE_THRESHOLD_PTS = 2;
const VOL_UNDERPRICED_THRESHOLD_PTS = -2;

export function computeHv20AnnualizedPct(
  bars: readonly { readonly sessionDate: string; readonly close: number }[] | null | undefined,
): number | null {
  if (!bars || bars.length < 21) return null;

  const sorted = [...bars].sort((left, right) =>
    left.sessionDate.localeCompare(right.sessionDate),
  );
  const recent = sorted.slice(-21);
  const returns: number[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1]!.close;
    const current = recent[index]!.close;
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0 || current <= 0) {
      return null;
    }
    returns.push(Math.log(current / previous));
  }

  if (returns.length < 20) return null;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  if (!Number.isFinite(dailyVol) || dailyVol <= 0) return null;

  return dailyVol * Math.sqrt(252) * 100;
}

function classifyVolMispricingSignal(spreadVolPts: number): VolMispricingSignal {
  if (spreadVolPts > VOL_EXPENSIVE_THRESHOLD_PTS) return "vol_expensive";
  if (spreadVolPts < VOL_UNDERPRICED_THRESHOLD_PTS) return "vol_underpriced";
  return "balanced";
}

export function formatVolMispricingPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  return `${value.toFixed(1)}%`;
}

export function formatIvHvSpreadVolPts(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} vol`;
}

export function volMispricingSignalLabel(
  signal: VolMispricingSignal | null,
): string {
  switch (signal) {
    case "vol_expensive":
      return "Vol expensive";
    case "balanced":
      return "Balanced";
    case "vol_underpriced":
      return "Vol underpriced";
    default:
      return "unavailable";
  }
}

export function formatOptionsIvCloseLabel(
  sessionDate: string | null,
  isFixture: boolean,
): string | null {
  if (!sessionDate) return null;
  const closeLabel = formatOptionsDataCloseLabel(sessionDate, isFixture);
  if (!closeLabel) return null;
  return closeLabel.replace(/^Options data · /, "Options IV · ").replace(
    /^Fixture · /,
    "Fixture IV · ",
  );
}

export function summarizeVolMispricing(input: {
  readonly representativeIv:
    | {
        readonly status: "available" | "unavailable";
        readonly value: number | null;
        readonly sessionDate: string;
      }
    | null
    | undefined;
  readonly hv20Bars: readonly { readonly sessionDate: string; readonly close: number }[] | null | undefined;
  readonly isFixture: boolean;
}): VolMispricingSummary {
  const ivField = input.representativeIv;
  const ivDecimal =
    ivField?.status === "available" &&
    ivField.value !== null &&
    Number.isFinite(ivField.value) &&
    ivField.value > 0
      ? ivField.value
      : null;

  const hv20Pct = computeHv20AnnualizedPct(input.hv20Bars);

  if (ivDecimal === null || hv20Pct === null) {
    return {
      ...VOL_MISPRICING_UNAVAILABLE,
      ivDataLabel:
        ivField
          ? formatOptionsIvCloseLabel(ivField.sessionDate, input.isFixture)
          : null,
    };
  }

  const ivPct = ivDecimal * 100;
  const spreadVolPts = Math.round((ivPct - hv20Pct) * 10) / 10;

  return {
    status: "available",
    ivPct: Math.round(ivPct * 10) / 10,
    hv20Pct: Math.round(hv20Pct * 10) / 10,
    spreadVolPts,
    signal: classifyVolMispricingSignal(spreadVolPts),
    ivDataLabel: formatOptionsIvCloseLabel(ivField!.sessionDate, input.isFixture),
  };
}

export type CtaProxyTrendSignal = "buying" | "neutral" | "selling";

export interface CtaProxySummary {
  readonly status: "available" | "unavailable";
  readonly signal: CtaProxyTrendSignal | null;
  readonly contextLine: string | null;
  readonly triggerLines: readonly string[];
}

const CTA_PROXY_UNAVAILABLE: CtaProxySummary = {
  status: "unavailable",
  signal: null,
  contextLine: null,
  triggerLines: [],
};

const CTA_HV_ELEVATED_PCT = 25;
const MA20_PERIOD = 20;
const MA50_PERIOD = 50;

export function computeCloseMovingAverage(
  bars: readonly { readonly sessionDate: string; readonly close: number }[],
  period: number,
): number | null {
  if (bars.length < period) return null;

  const sorted = [...bars].sort((left, right) =>
    left.sessionDate.localeCompare(right.sessionDate),
  );
  const recent = sorted.slice(-period);
  let sum = 0;
  for (const bar of recent) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) return null;
    sum += bar.close;
  }
  return sum / period;
}

function latestBarSessionDate(
  bars: readonly { readonly sessionDate: string; readonly close: number }[],
): string | null {
  if (bars.length === 0) return null;
  const sorted = [...bars].sort((left, right) =>
    left.sessionDate.localeCompare(right.sessionDate),
  );
  return sorted.at(-1)?.sessionDate ?? null;
}

function classifySymbolCtaTrend(
  price: number,
  ma20: number,
  ma50: number,
): CtaProxyTrendSignal {
  const buying = price > ma20 && price > ma50 && ma20 >= ma50;
  const selling = price < ma20 && price < ma50 && ma20 <= ma50;
  if (buying) return "buying";
  if (selling) return "selling";
  return "neutral";
}

function combineCtaTrendSignals(
  spyTrend: CtaProxyTrendSignal,
  qqqTrend: CtaProxyTrendSignal,
): CtaProxyTrendSignal {
  if (spyTrend === "buying" && qqqTrend === "buying") return "buying";
  if (spyTrend === "selling" && qqqTrend === "selling") return "selling";
  return "neutral";
}

function ctaProxyContextLine(signal: CtaProxyTrendSignal): string {
  switch (signal) {
    case "buying":
      return "SPY & QQQ above MA20 & MA50 · systematic trend proxy";
    case "selling":
      return "SPY & QQQ below MA20 & MA50 · systematic trend proxy";
    case "neutral":
      return "Mixed vs MA20/MA50 · no clear systematic tilt";
  }
}

function formatCtaTriggerLevel(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (value >= 100) return String(Math.round(value));
  return (Math.round(value * 10) / 10).toFixed(1);
}

function deriveCtaTriggerLines(
  signal: CtaProxyTrendSignal,
  spyMa20: number | null,
  spyMa50: number | null,
): readonly string[] {
  const lines: string[] = [];
  if (spyMa20 !== null && signal !== "selling") {
    lines.push(`Sell pressure below ${formatCtaTriggerLevel(spyMa20)}`);
  }
  if (spyMa50 !== null && signal !== "buying") {
    lines.push(`Buy reinforcement above ${formatCtaTriggerLevel(spyMa50)}`);
  }
  return lines;
}

/**
 * Deterministic systematic trend proxy — not dealer or institutional CTA positioning.
 */
export function summarizeCtaProxy(input: {
  readonly spyBars: readonly { readonly sessionDate: string; readonly close: number }[] | null | undefined;
  readonly qqqBars: readonly { readonly sessionDate: string; readonly close: number }[] | null | undefined;
  readonly spyPrice: number | null;
  readonly qqqPrice: number | null;
  readonly targetSession: string;
}): CtaProxySummary {
  const spyBars = input.spyBars;
  const qqqBars = input.qqqBars;

  if (!spyBars?.length || !qqqBars?.length) {
    return CTA_PROXY_UNAVAILABLE;
  }

  const spyLastSession = latestBarSessionDate(spyBars);
  const qqqLastSession = latestBarSessionDate(qqqBars);
  if (
    spyLastSession !== input.targetSession ||
    qqqLastSession !== input.targetSession
  ) {
    return CTA_PROXY_UNAVAILABLE;
  }

  const spyMa20 = computeCloseMovingAverage(spyBars, MA20_PERIOD);
  const spyMa50 = computeCloseMovingAverage(spyBars, MA50_PERIOD);
  const qqqMa20 = computeCloseMovingAverage(qqqBars, MA20_PERIOD);
  const qqqMa50 = computeCloseMovingAverage(qqqBars, MA50_PERIOD);

  if (
    input.spyPrice === null ||
    input.qqqPrice === null ||
    spyMa20 === null ||
    spyMa50 === null ||
    qqqMa20 === null ||
    qqqMa50 === null
  ) {
    return CTA_PROXY_UNAVAILABLE;
  }

  const spyTrend = classifySymbolCtaTrend(input.spyPrice, spyMa20, spyMa50);
  const qqqTrend = classifySymbolCtaTrend(input.qqqPrice, qqqMa20, qqqMa50);
  let signal = combineCtaTrendSignals(spyTrend, qqqTrend);

  const spyHv20 = computeHv20AnnualizedPct(spyBars);
  if (signal === "buying" && spyHv20 !== null && spyHv20 >= CTA_HV_ELEVATED_PCT) {
    signal = "neutral";
  }

  return {
    status: "available",
    signal,
    contextLine: ctaProxyContextLine(signal),
    triggerLines: deriveCtaTriggerLines(signal, spyMa20, spyMa50),
  };
}

export function ctaProxySignalLabel(
  signal: CtaProxyTrendSignal | null,
  status: CtaProxySummary["status"],
): string {
  if (status !== "available" || signal === null) return "unavailable";
  switch (signal) {
    case "buying":
      return "Buying";
    case "neutral":
      return "Neutral";
    case "selling":
      return "Selling";
  }
}
