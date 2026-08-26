/**
 * HYG/LQD credit appetite from Alpaca daily closes.
 * Display / AI Study only — never an input to Risk, Opportunity, Trend, or Positioning.
 */
import { equityBarsThroughSession } from "@/desk/format-gamma";

export const HYG_LQD_BAR_SYMBOLS = ["HYG", "LQD"] as const;

export type HygLqdCreditLabel = "weakening" | "stable" | "improving";

export interface HygLqdCreditSignal {
  readonly status: "available" | "unavailable";
  readonly sessionDate: string | null;
  readonly ratio: number | null;
  readonly change1dPct: number | null;
  readonly trend5dPct: number | null;
  readonly signal: HygLqdCreditLabel | null;
  readonly spyChange1dPct: number | null;
  readonly missingReason: string | null;
}

export const UNAVAILABLE_HYG_LQD_CREDIT: HygLqdCreditSignal = {
  status: "unavailable",
  sessionDate: null,
  ratio: null,
  change1dPct: null,
  trend5dPct: null,
  signal: null,
  spyChange1dPct: null,
  missingReason: "HYG/LQD daily bars not loaded.",
};

const STABLE_1D_ABS_PCT = 0.15;
const STABLE_5D_ABS_PCT = 0.35;

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function closeOnSession(
  bars: readonly { readonly sessionDate: string; readonly close: number }[],
  sessionDate: string,
): number | null {
  const bar = bars.find((row) => row.sessionDate === sessionDate);
  if (!bar || !Number.isFinite(bar.close) || bar.close <= 0) return null;
  return bar.close;
}

function alignedRatioSeries(
  hyg: readonly { readonly sessionDate: string; readonly close: number }[],
  lqd: readonly { readonly sessionDate: string; readonly close: number }[],
  sessionDate: string,
): readonly { readonly sessionDate: string; readonly ratio: number }[] {
  const lqdByDate = new Map(lqd.map((bar) => [bar.sessionDate, bar.close]));
  const rows: { sessionDate: string; ratio: number }[] = [];
  for (const bar of hyg) {
    if (bar.sessionDate > sessionDate) continue;
    const lqdClose = lqdByDate.get(bar.sessionDate);
    if (
      lqdClose === undefined ||
      !Number.isFinite(bar.close) ||
      bar.close <= 0 ||
      !Number.isFinite(lqdClose) ||
      lqdClose <= 0
    ) {
      continue;
    }
    rows.push({ sessionDate: bar.sessionDate, ratio: bar.close / lqdClose });
  }
  return rows.sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
}

export function classifyHygLqdCredit(
  change1dPct: number | null,
  trend5dPct: number | null,
): HygLqdCreditLabel | null {
  if (change1dPct === null && trend5dPct === null) return null;
  const d1 = change1dPct ?? 0;
  const d5 = trend5dPct ?? 0;
  const near1d = change1dPct === null || Math.abs(change1dPct) < STABLE_1D_ABS_PCT;
  const near5d = trend5dPct === null || Math.abs(trend5dPct) < STABLE_5D_ABS_PCT;
  if (near1d && near5d) return "stable";
  if (d5 < 0 && d1 <= 0) return "weakening";
  if (d5 > 0 && d1 >= 0) return "improving";
  if (trend5dPct !== null && trend5dPct <= -STABLE_5D_ABS_PCT) return "weakening";
  if (trend5dPct !== null && trend5dPct >= STABLE_5D_ABS_PCT) return "improving";
  if (change1dPct !== null && change1dPct < 0 && near5d) return "weakening";
  if (change1dPct !== null && change1dPct > 0 && near5d) return "improving";
  return "stable";
}

export function deriveHygLqdCreditSignal(input: {
  readonly equityBarsBySymbol?: ReadonlyMap<
    string,
    readonly { readonly sessionDate: string; readonly close: number }[]
  >;
  readonly targetSession: string | null;
}): HygLqdCreditSignal {
  const sessionDate = input.targetSession;
  if (!sessionDate) return UNAVAILABLE_HYG_LQD_CREDIT;
  const map = input.equityBarsBySymbol;
  if (!map) return UNAVAILABLE_HYG_LQD_CREDIT;

  const hyg = equityBarsThroughSession(map.get("HYG"), sessionDate);
  const lqd = equityBarsThroughSession(map.get("LQD"), sessionDate);
  const spy = equityBarsThroughSession(map.get("SPY"), sessionDate);

  if (hyg.length === 0 || lqd.length === 0) {
    return {
      ...UNAVAILABLE_HYG_LQD_CREDIT,
      missingReason: "HYG/LQD daily bars not loaded.",
    };
  }

  const hygClose = closeOnSession(hyg, sessionDate);
  const lqdClose = closeOnSession(lqd, sessionDate);
  if (hygClose === null || lqdClose === null) {
    return {
      ...UNAVAILABLE_HYG_LQD_CREDIT,
      missingReason: `HYG/LQD closes not aligned to ${sessionDate}.`,
    };
  }

  const series = alignedRatioSeries(hyg, lqd, sessionDate);
  const last = series.at(-1);
  if (!last || last.sessionDate !== sessionDate) {
    return {
      ...UNAVAILABLE_HYG_LQD_CREDIT,
      missingReason: `HYG/LQD ratio not aligned to ${sessionDate}.`,
    };
  }

  const prior1 = series.at(-2);
  const prior5 = series.at(-6);
  const change1dPct =
    prior1 && prior1.ratio > 0
      ? roundPct((last.ratio / prior1.ratio - 1) * 100)
      : null;
  const trend5dPct =
    prior5 && prior5.ratio > 0
      ? roundPct((last.ratio / prior5.ratio - 1) * 100)
      : null;

  const spyClose = closeOnSession(spy, sessionDate);
  const spyPrior = spy.filter((bar) => bar.sessionDate < sessionDate).at(-1);
  const spyChange1dPct =
    spyClose !== null && spyPrior && spyPrior.close > 0
      ? roundPct((spyClose / spyPrior.close - 1) * 100)
      : null;

  return {
    status: "available",
    sessionDate,
    ratio: roundRatio(last.ratio),
    change1dPct,
    trend5dPct,
    signal: classifyHygLqdCredit(change1dPct, trend5dPct),
    spyChange1dPct,
    missingReason: null,
  };
}

export function formatHygLqdPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value}%`;
}
