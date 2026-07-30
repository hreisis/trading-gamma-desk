import type { EquityLeadership } from "@/contracts";
import { LEADERSHIP_THRESHOLD_PCT } from "./rules";

/**
 * Relative leadership of QQQ/IWM vs SPY in the same window.
 * Spreads are percentage-point differences of cumulative % changes.
 * Never framed as confirmed rotation or capital flows.
 */
export function classifyEquityLeadership(options: {
  readonly spyPct: number | null | undefined;
  readonly qqqPct: number | null | undefined;
  readonly iwmPct: number | null | undefined;
  readonly thresholdPct?: number;
}): EquityLeadership {
  const threshold = options.thresholdPct ?? LEADERSHIP_THRESHOLD_PCT;
  const spy = options.spyPct;
  const qqq = options.qqqPct;
  const iwm = options.iwmPct;

  if (
    spy === null ||
    spy === undefined ||
    !Number.isFinite(spy) ||
    qqq === null ||
    qqq === undefined ||
    !Number.isFinite(qqq) ||
    iwm === null ||
    iwm === undefined ||
    !Number.isFinite(iwm)
  ) {
    return { status: "unavailable", thresholdPct: threshold };
  }

  const qqqMinusSpyPct = round4(qqq - spy);
  const iwmMinusSpyPct = round4(iwm - spy);
  const qqqLeads = qqqMinusSpyPct > threshold;
  const iwmLeads = iwmMinusSpyPct > threshold;
  const qqqLags = qqqMinusSpyPct < -threshold;
  const iwmLags = iwmMinusSpyPct < -threshold;

  // Conflict: both claim leadership, or one leads while the other clearly lags.
  if (qqqLeads && iwmLeads) {
    return {
      status: "mixed",
      qqqMinusSpyPct,
      iwmMinusSpyPct,
      thresholdPct: threshold,
    };
  }
  if ((qqqLeads && iwmLags) || (iwmLeads && qqqLags)) {
    return {
      status: "mixed",
      qqqMinusSpyPct,
      iwmMinusSpyPct,
      thresholdPct: threshold,
    };
  }
  if (qqqLeads) {
    return {
      status: "nasdaq_proxy_leads",
      qqqMinusSpyPct,
      iwmMinusSpyPct,
      thresholdPct: threshold,
    };
  }
  if (iwmLeads) {
    return {
      status: "small_cap_proxy_leads",
      qqqMinusSpyPct,
      iwmMinusSpyPct,
      thresholdPct: threshold,
    };
  }
  return {
    status: "no_clear_leader",
    qqqMinusSpyPct,
    iwmMinusSpyPct,
    thresholdPct: threshold,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
