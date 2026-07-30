import type {
  CrossAssetSignature,
  EquityBreadth,
  EquityLeadership,
  ReactionDirection,
  ReactionObservation,
  ReactionWindowClassification,
  ReactionWindowId,
} from "@/contracts";

function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function breadthPhrase(b: EquityBreadth): string | null {
  switch (b) {
    case "broadly_higher":
      return "broadly higher";
    case "broadly_lower":
      return "broadly lower";
    case "mixed":
      return "mixed";
    case "flat":
      return "flat";
    default:
      return null;
  }
}

function windowLabel(w: ReactionWindowId): string {
  switch (w) {
    case "5m":
      return "+5m";
    case "30m":
      return "+30m";
    case "2h":
      return "+2h";
    case "session_close":
      return "session close";
  }
}

function directionPhrase(d: ReactionDirection): string | null {
  if (d === "up") return "higher";
  if (d === "down") return "lower";
  if (d === "flat") return "flat";
  return null;
}

/**
 * Controlled template observations (0–4). Prefer fewer over padded claims.
 * Never emits liked/disliked, bullish/bearish, risk-on/off, or causation.
 */
export function buildObservations(options: {
  readonly windows: readonly ReactionWindowClassification[];
  readonly from5mTo30m: string;
  readonly intoSessionClose: string;
  readonly spy5m?: number;
  readonly spyClose?: number;
  readonly spy5mDir?: ReactionDirection;
  readonly spyCloseDir?: ReactionDirection;
}): ReactionObservation[] {
  const out: ReactionObservation[] = [];
  const byWindow = new Map(options.windows.map((w) => [w.window, w]));

  const preferOrder: ReactionWindowId[] = ["30m", "2h", "5m", "session_close"];
  for (const wid of preferOrder) {
    if (out.length >= 4) break;
    const w = byWindow.get(wid);
    if (!w) continue;
    const phrase = breadthPhrase(w.equityBreadth);
    if (!phrase || w.equityBreadth === "unavailable") continue;
    out.push({
      id: `obs_breadth_${wid}`,
      text: `At ${windowLabel(wid)}, the three equity ETF proxies were ${phrase}.`,
      window: wid,
      symbolInputs: ["SPY", "QQQ", "IWM"],
      ruleId: "obs.equity_breadth",
      sourceValues: {
        equityBreadth: w.equityBreadth,
        spy: instrumentPct(w, "SPY"),
        qqq: instrumentPct(w, "QQQ"),
        iwm: instrumentPct(w, "IWM"),
      },
    });
    break;
  }

  for (const wid of ["2h", "30m", "session_close"] as ReactionWindowId[]) {
    if (out.length >= 4) break;
    const w = byWindow.get(wid);
    if (!w) continue;
    const lead = w.equityLeadership;
    if (
      lead.status === "nasdaq_proxy_leads" &&
      lead.qqqMinusSpyPct !== undefined
    ) {
      out.push({
        id: `obs_lead_qqq_${wid}`,
        text: `QQQ outperformed SPY by ${Math.abs(lead.qqqMinusSpyPct).toFixed(2)} percentage points at ${windowLabel(wid)}.`,
        window: wid,
        symbolInputs: ["QQQ", "SPY"],
        ruleId: "obs.equity_leadership_qqq",
        sourceValues: {
          qqqMinusSpyPct: lead.qqqMinusSpyPct,
          thresholdPct: lead.thresholdPct,
        },
      });
      break;
    }
    if (
      lead.status === "small_cap_proxy_leads" &&
      lead.iwmMinusSpyPct !== undefined
    ) {
      out.push({
        id: `obs_lead_iwm_${wid}`,
        text: `IWM outperformed SPY by ${Math.abs(lead.iwmMinusSpyPct).toFixed(2)} percentage points at ${windowLabel(wid)}.`,
        window: wid,
        symbolInputs: ["IWM", "SPY"],
        ruleId: "obs.equity_leadership_iwm",
        sourceValues: {
          iwmMinusSpyPct: lead.iwmMinusSpyPct,
          thresholdPct: lead.thresholdPct,
        },
      });
      break;
    }
  }

  for (const wid of ["30m", "2h", "session_close"] as ReactionWindowId[]) {
    if (out.length >= 4) break;
    const w = byWindow.get(wid);
    if (!w) continue;
    const sig = w.crossAssetSignature;
    const tlt = directionPhrase(sig.longTreasuryEtf);
    const uup = directionPhrase(sig.dollarEtf);
    if (!tlt || !uup) continue;
    if (sig.longTreasuryEtf === "unavailable" || sig.dollarEtf === "unavailable") {
      continue;
    }
    out.push({
      id: `obs_cross_${wid}`,
      text: `The long-Treasury ETF proxy was ${tlt} while the dollar ETF proxy was ${uup}.`,
      window: wid,
      symbolInputs: ["TLT", "UUP"],
      ruleId: "obs.cross_asset_tlt_uup",
      sourceValues: {
        longTreasuryEtf: sig.longTreasuryEtf,
        dollarEtf: sig.dollarEtf,
        tltPct: instrumentPct(w, "TLT"),
        uupPct: instrumentPct(w, "UUP"),
      },
    });
    break;
  }

  if (
    out.length < 4 &&
    options.intoSessionClose === "faded" &&
    options.spy5mDir &&
    options.spy5mDir !== "unavailable" &&
    options.spy5mDir !== "flat" &&
    options.spy5m !== undefined &&
    options.spyClose !== undefined
  ) {
    out.push({
      id: "obs_spy_fade_close",
      text: "The initial SPY move had faded by the session close.",
      window: "session_close",
      symbolInputs: ["SPY"],
      ruleId: "obs.spy_fade_into_close",
      sourceValues: {
        spy5mPct: options.spy5m,
        spyClosePct: options.spyClose,
        development: options.intoSessionClose,
      },
    });
  }

  return out.slice(0, 4);
}

function instrumentPct(
  w: ReactionWindowClassification,
  symbol: string,
): number | null {
  const inst = w.instruments.find((i) => i.symbol === symbol);
  return inst?.changePct ?? null;
}

/** Render structured signature to neutral template text (for UI). */
export function formatCrossAssetSignatureText(
  sig: CrossAssetSignature,
): string {
  const eq =
    sig.equities === "higher"
      ? "Equities higher"
      : sig.equities === "lower"
        ? "Equities lower"
        : sig.equities === "flat"
          ? "Equities flat"
          : sig.equities === "mixed"
            ? "Equities mixed"
            : "Equities unavailable";
  const tlt = leg("Long Treasury ETF", sig.longTreasuryEtf);
  const uup = leg("Dollar ETF", sig.dollarEtf);
  const gld = leg("Gold ETF", sig.goldEtf);
  return `${eq} · ${tlt} · ${uup} · ${gld}`;
}

function leg(label: string, d: ReactionDirection): string {
  if (d === "up") return `${label} higher`;
  if (d === "down") return `${label} lower`;
  if (d === "flat") return `${label} flat`;
  return `${label} unavailable`;
}

export function formatLeadershipText(lead: EquityLeadership): string {
  switch (lead.status) {
    case "nasdaq_proxy_leads":
      return `Nasdaq proxy leads (QQQ−SPY ${formatPct(lead.qqqMinusSpyPct ?? 0)}; threshold ${lead.thresholdPct}pp)`;
    case "small_cap_proxy_leads":
      return `Small-cap proxy leads (IWM−SPY ${formatPct(lead.iwmMinusSpyPct ?? 0)}; threshold ${lead.thresholdPct}pp)`;
    case "no_clear_leader":
      return `No clear leader (threshold ${lead.thresholdPct}pp)`;
    case "mixed":
      return "Mixed leadership";
    case "unavailable":
      return "Leadership unavailable";
  }
}
