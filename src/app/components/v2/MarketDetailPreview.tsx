"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { V2CommandCenterPageView } from "@/desk/load-v2-home";
import type { V2Language } from "@/desk";
import type { ManualGammaSnapshot } from "@/desk/manual-gamma";
import type { PositioningV2Label } from "@/desk/positioning-v2";
import type { RiskTrendV2Label } from "@/desk/risk-trend-v2";
import { isUsEquityRegularSessionOpen } from "@/desk/us-equity-session";
import { localizeMarketAiStudySections } from "@/desk/v2-ai-study-market-zh";
import { interpretV2Policy } from "@/desk/v2-policy-interpretation";

const EN = {
  brandSub: "Market Structure Copilot",
  overview: "Overview",
  marketStructure: "Market Structure",
  indexGamma: "Index Gamma",
  sectorRotation: "Sector Rotation",
  aiStudy: "AI Study",
  dailyReview: "Daily Review",
  delayed: "CBOE delayed ~15m",
  marketOpen: "Market Open",
  marketClosed: "Market Closed",
  refresh: "Refresh",
  back: "Back",
  language: "Language",
  sentiment: "MARKET SENTIMENT",
  vsYesterday: "vs yesterday",
  riskScore: "Risk Score",
  opportunity: "Opportunity",
  trend: "Trend",
  positioning: "Positioning",
  exposure: "RISK-BASED EXPOSURE",
  overallExposure: "Exposure Band",
  unavailable: "Unavailable",
  exposureBand: "Band",
  drivers: "KEY DRIVER ALLOCATION",
  driversNote: "How today's factors contribute to risk",
  breadth: "Breadth",
  gamma: "Gamma",
  volatility: "Volatility",
  macro: "Macro",
  event: "Event",
  structureTitle: "MARKET STRUCTURE",
  dealerFlow: "Dealer Flow (Net GEX)",
  gammaFlip: "Gamma Flip",
  callWall: "Call Wall",
  putWall: "Put Wall",
  spot: "Spot",
  negativeGamma: "Negative Gamma",
  zeroGamma: "Zero Gamma",
  positiveGamma: "Positive Gamma",
  rotationTitle: "SECTOR ROTATION",
  vsSpy: "(vs SPY)",
  leading: "Leading / Improving",
  weakening: "Weakening",
  riskSnapshot: "RISK SNAPSHOT",
  qqqSpySpread: "QQQ vs SPY Spread",
  highBeta: "High Beta",
  target: "Target",
  tilt: "tilt",
  riskBasedAlloc: "risk-based allocation",
  dataAsOf: "Data as of",
  priceDelayed: "Price ~15 min delayed (CBOE)",
  sourceManual: "Source: Manual (GEXTool)",
  aiGenerated: "Generated from current inputs",
  keyTakeaway: "Key Takeaway",
  whatToWatch: "What to Watch",
  primaryRisks: "PRIMARY RISKS",
  opportunities: "OPPORTUNITIES",
  hiddenRisk: "HIDDEN RISK",
  reactionQuality: "REACTION QUALITY",
  crossAssetConflict: "CROSS-ASSET CONFLICT",
  whatChanged: "WHAT CHANGED",
  whatMattersNext: "WHAT MATTERS NEXT",
  viewAll: "View all",
  reviewPendingStructure: "Market structure review pending.",
  reviewPendingVol: "Volatility review pending.",
  reviewPendingBreadth: "Breadth review pending.",
  reviewPendingMacro: "Macro review pending.",
  manualTitle: "MANUAL GAMMA INPUT",
  closeManual: "Close manual gamma input",
  source: "Source",
  priceAsOf: "Price as-of (ET)",
  oiAsOf: "OI as-of (OCC)",
  notes: "Notes (optional)",
  notesPlaceholder: "e.g. GEXTool snapshot",
  cancel: "Cancel",
  save: "Save & Update",
  saving: "Saving…",
  openManual: "Manual Gamma Input",
};

const ZH: typeof EN = {
  brandSub: "市场结构助手",
  overview: "总览",
  marketStructure: "市场结构",
  indexGamma: "指数 Gamma",
  sectorRotation: "板块轮动",
  aiStudy: "AI 研报",
  dailyReview: "每日复盘",
  delayed: "CBOE 延迟约 15 分钟",
  marketOpen: "开盘中",
  marketClosed: "已收盘",
  refresh: "刷新",
  back: "返回",
  language: "语言",
  sentiment: "市场情绪",
  vsYesterday: "较昨日",
  riskScore: "风险分数",
  opportunity: "机会分数",
  trend: "风险趋势",
  positioning: "仓位建议",
  exposure: "风险映射敞口",
  overallExposure: "敞口区间",
  unavailable: "不可用",
  exposureBand: "区间",
  drivers: "关键驱动权重",
  driversNote: "今日各因子对风险的贡献",
  breadth: "广度",
  gamma: "Gamma",
  volatility: "波动率",
  macro: "宏观",
  event: "事件",
  structureTitle: "市场结构",
  dealerFlow: "做市商流向 (Net GEX)",
  gammaFlip: "Gamma Flip",
  callWall: "Call Wall",
  putWall: "Put Wall",
  spot: "现价",
  negativeGamma: "负 Gamma",
  zeroGamma: "零 Gamma",
  positiveGamma: "正 Gamma",
  rotationTitle: "板块轮动",
  vsSpy: "（相对 SPY）",
  leading: "领涨 / 改善",
  weakening: "走弱",
  riskSnapshot: "风险快照",
  qqqSpySpread: "QQQ 相对 SPY 利差",
  highBeta: "高 Beta",
  target: "目标",
  tilt: "倾斜",
  riskBasedAlloc: "风险映射权重，非最终操作",
  dataAsOf: "数据截至",
  priceDelayed: "价格延迟约 15 分钟（CBOE）",
  sourceManual: "来源：手动（GEXTool）",
  aiGenerated: "由当前输入生成",
  keyTakeaway: "核心结论",
  whatToWatch: "关注点",
  primaryRisks: "主要风险",
  opportunities: "机会",
  hiddenRisk: "隐性风险",
  reactionQuality: "市场反应质量",
  crossAssetConflict: "跨资产冲突",
  whatChanged: "发生了什么变化",
  whatMattersNext: "接下来关注什么",
  viewAll: "查看全部",
  reviewPendingStructure: "市场结构复盘待更新。",
  reviewPendingVol: "波动率复盘待更新。",
  reviewPendingBreadth: "广度复盘待更新。",
  reviewPendingMacro: "宏观复盘待更新。",
  manualTitle: "手动 Gamma 输入",
  closeManual: "关闭手动 Gamma 输入",
  source: "来源",
  priceAsOf: "价格时点（美东）",
  oiAsOf: "持仓时点（OCC）",
  notes: "备注（可选）",
  notesPlaceholder: "例如 GEXTool 快照",
  cancel: "取消",
  save: "保存并更新",
  saving: "保存中…",
  openManual: "手动 Gamma 输入",
};

type MarketCopy = typeof EN;

function fmt(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function signed(value: number | null | undefined, suffix = "%", digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function gammaFor(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  return view.gamma.find((row) => row.symbol === symbol);
}

export type MarketGammaStateKind =
  | "amplifying"
  | "transition"
  | "stabilizing"
  | "unknown";

export function describeMarketGammaState(
  gamma:
    | {
        readonly regime?: string | null;
        readonly spot?: number | null;
        readonly gammaFlip?: number | null;
      }
    | undefined,
  lang: V2Language,
): { kind: MarketGammaStateKind; title: string; note: string } {
  const regime = (gamma?.regime ?? "").toLowerCase().replaceAll(" ", "_");
  const spot = gamma?.spot;
  const flip = gamma?.gammaFlip;
  const belowFlip =
    spot != null &&
    flip != null &&
    Number.isFinite(spot) &&
    Number.isFinite(flip) &&
    spot < flip;

  if (regime.includes("negative") || belowFlip) {
    return lang === "zh"
      ? {
          kind: "amplifying",
          title: "市场状态：放大中",
          note: "现价低于 gamma flip，或 gamma 为负。做市对冲可能放大波动，这不是稳定状态。",
        }
      : {
          kind: "amplifying",
          title: "Market State: AMPLIFYING",
          note: "Spot is below gamma flip or gamma is negative. Dealer hedging can amplify moves — this is not a stabilizing regime.",
        };
  }
  if (regime.includes("near_zero")) {
    return lang === "zh"
      ? {
          kind: "transition",
          title: "市场状态：转换中",
          note: "价格靠近零 gamma，除非跌破 flip，否则以双向震荡为主。",
        }
      : {
          kind: "transition",
          title: "Market State: TRANSITION",
          note: "Price near zero-gamma. Expect two-way chop unless flip breaks.",
        };
  }
  if (regime.includes("positive")) {
    return lang === "zh"
      ? {
          kind: "stabilizing",
          title: "市场状态：稳定中",
          note: "正 gamma / 现价在 flip 上方。除非跌破 flip，否则以双向震荡为主。",
        }
      : {
          kind: "stabilizing",
          title: "Market State: STABILIZING",
          note: "Positive gamma / above flip. Expect two-way chop unless flip breaks.",
        };
  }
  return lang === "zh"
    ? {
        kind: "unknown",
        title: "市场状态：数据不足",
        note: "Gamma 状态不完整，不能默认当成稳定市场。",
      }
    : {
        kind: "unknown",
        title: "Market State: INCOMPLETE",
        note: "Gamma regime is incomplete; do not assume a stabilizing market.",
      };
}

function riskLabel(score: number | null, lang: V2Language) {
  if (score == null) return lang === "zh" ? "不可用" : "Unavailable";
  if (score <= 40) return lang === "zh" ? "低风险" : "Low Risk";
  if (score <= 65) return lang === "zh" ? "中性" : "Neutral";
  return lang === "zh" ? "偏高风险" : "Elevated";
}

function riskAngle(score: number | null) {
  const bounded = Math.max(0, Math.min(100, score ?? 50));
  return -180 + bounded * 1.8;
}

function formatRiskDivergenceValue(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
}

function highBetaTilt(riskDivergence: number | null): number {
  if (riskDivergence == null || !Number.isFinite(riskDivergence)) return 0;
  if (riskDivergence >= 15) return -5;
  if (riskDivergence >= 5) return -2;
  if (riskDivergence <= -15) return 5;
  if (riskDivergence <= -5) return 2;
  return 0;
}

function factorSignal(view: V2CommandCenterPageView, id: string) {
  const spy = gammaFor(view, "SPY");
  if (id === "breadth") return view.spyBreadth.breadthSignal ?? "—";
  if (id === "gamma") return spy?.regime?.replaceAll("_", " ") ?? "—";
  if (id === "vol") return spy?.volMispricing?.signal ?? "—";
  if (id === "macro") return view.macroSummary?.label ?? view.macroLabel ?? "—";
  if (id === "event_gate") return view.eventGate?.state ?? "—";
  return "—";
}

function factorTone(id: string, signal: string) {
  const value = signal.toLowerCase();
  if (id === "gamma" && value.includes("negative")) return "bad";
  if (id === "gamma" && value.includes("positive")) return "good";
  if (id === "breadth" && value.includes("weak")) return "bad";
  if (id === "breadth" && value.includes("strong")) return "good";
  if (id === "vol" && value.includes("expensive")) return "bad";
  if (id === "vol" && value.includes("underpriced")) return "good";
  if (id === "event_gate" && !value.includes("clear")) return "bad";
  return "neutral";
}

function inputDefault(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "" : value.toFixed(digits);
}

export function HomeManualGammaInput({ view, lang }: { view: V2CommandCenterPageView; lang: V2Language }) {
  const [open, setOpen] = useState(false);
  const copy = lang === "zh" ? ZH : EN;
  return <div className="home-manual"><style>{`.home-manual{padding:12px;border:1px solid #203246;border-radius:8px}.home-manual button{padding:8px 12px;cursor:pointer}.home-manual form{display:grid;gap:12px}.home-manual label{display:grid;grid-template-columns:160px 1fr 1fr;gap:12px}.home-manual input,.home-manual select,.home-manual textarea{min-width:0;padding:8px}.home-manual .mk-manual-symbols{display:flex;justify-content:space-evenly}.home-manual .mk-manual-head{display:flex;justify-content:space-between}`}</style>{open ? <ManualGammaPanel view={view} snapshot={view.manualGammaSnapshot ?? null} copy={copy} onClose={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>{copy.openManual}</button>}</div>;
}

function ManualGammaPanel({
  view,
  snapshot,
  copy,
  onClose,
}: {
  view: V2CommandCenterPageView;
  snapshot: ManualGammaSnapshot | null;
  copy: MarketCopy;
  onClose: () => void;
}) {
  const spy = gammaFor(view, "SPY");
  const qqq = gammaFor(view, "QQQ");
  const [saving, setSaving] = useState(false);

  const rows = [
    ["Spot", "spot", snapshot?.symbols.SPY.spot ?? spy?.spot, snapshot?.symbols.QQQ.spot ?? qqq?.spot],
    ["Net GEX ($B)", "netGexBillions", snapshot?.symbols.SPY.netGexBillions ?? (spy?.netGex == null ? null : spy.netGex / 1e9), snapshot?.symbols.QQQ.netGexBillions ?? (qqq?.netGex == null ? null : qqq.netGex / 1e9)],
    ["Gamma Flip", "gammaFlip", snapshot?.symbols.SPY.gammaFlip ?? spy?.gammaFlip, snapshot?.symbols.QQQ.gammaFlip ?? qqq?.gammaFlip],
    ["Call Wall", "callWall", snapshot?.symbols.SPY.callWall ?? spy?.callWall, snapshot?.symbols.QQQ.callWall ?? qqq?.callWall],
    ["Put Wall", "putWall", snapshot?.symbols.SPY.putWall ?? spy?.putWall, snapshot?.symbols.QQQ.putWall ?? qqq?.putWall],
    ["IV30 (%)", "iv30Pct", snapshot?.symbols.SPY.iv30Pct ?? spy?.volMispricing.ivPct, snapshot?.symbols.QQQ.iv30Pct ?? qqq?.volMispricing.ivPct],
  ] as const;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const number = (name: string) => Number(form.get(name));
    const payload = {
      source: String(form.get("source") ?? "GEXTool"),
      priceAsOfEt: String(form.get("priceAsOfEt") ?? ""),
      oiAsOf: String(form.get("oiAsOf") ?? ""),
      notes: String(form.get("notes") ?? ""),
      symbols: {
        SPY: {
          spot: number("SPY.spot"),
          netGexBillions: number("SPY.netGexBillions"),
          gammaFlip: number("SPY.gammaFlip"),
          callWall: number("SPY.callWall"),
          putWall: number("SPY.putWall"),
          iv30Pct: number("SPY.iv30Pct"),
        },
        QQQ: {
          spot: number("QQQ.spot"),
          netGexBillions: number("QQQ.netGexBillions"),
          gammaFlip: number("QQQ.gammaFlip"),
          callWall: number("QQQ.callWall"),
          putWall: number("QQQ.putWall"),
          iv30Pct: number("QQQ.iv30Pct"),
        },
      },
    };

    setSaving(true);
    try {
      const response = await fetch("/api/manual-gamma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        window.alert(body?.error ?? "Manual Gamma save failed.");
        return;
      }
      window.location.reload();
    } catch {
      window.alert("Manual Gamma save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mk-manual-panel" aria-label={copy.manualTitle} onSubmit={handleSubmit}>
      <div className="mk-manual-head">
        <h3>{copy.manualTitle}</h3>
        <button type="button" onClick={onClose} aria-label={copy.closeManual}>×</button>
      </div>
      <label className="mk-source">
        <span>{copy.source}</span>
        <select name="source" defaultValue={snapshot?.source ?? "GEXTool"}>
          <option>GEXTool</option>
          <option>Manual</option>
        </select>
      </label>
      <div className="mk-manual-symbols"><b>SPY</b><b>QQQ</b></div>
      {rows.map(([label, key, spyValue, qqqValue]) => (
        <label className="mk-manual-row" key={key}>
          <span>{label}</span>
          <input name={`SPY.${key}`} type="number" step="any" required defaultValue={inputDefault(spyValue)} />
          <input name={`QQQ.${key}`} type="number" step="any" required defaultValue={inputDefault(qqqValue)} />
        </label>
      ))}
      <label className="mk-manual-wide"><span>{copy.priceAsOf}</span><input name="priceAsOfEt" type="datetime-local" required defaultValue={snapshot?.priceAsOfEt ?? ""} /></label>
      <label className="mk-manual-wide"><span>{copy.oiAsOf}</span><input name="oiAsOf" type="date" required defaultValue={snapshot?.oiAsOf ?? ""} /></label>
      <label className="mk-manual-wide"><span>{copy.notes}</span><textarea name="notes" rows={2} placeholder={copy.notesPlaceholder} defaultValue={snapshot?.notes ?? ""} /></label>
      <div className="mk-manual-actions">
        <button type="button" className="secondary" onClick={onClose}>{copy.cancel}</button>
        <button type="submit" className="primary" disabled={saving}>{saving ? copy.saving : copy.save}</button>
      </div>
    </form>
  );
}

function RiskGauge({ score, lang }: { score: number | null; lang: V2Language }) {
  const style = { "--mk-risk-angle": `${riskAngle(score)}deg` } as CSSProperties;
  return (
    <div className="mk-risk-wrap">
      <div className="mk-gauge" style={style}>
        <div className="mk-gauge-arc" />
        <div className="mk-gauge-needle" />
        <div className="mk-gauge-pivot" />
        <b>{score ?? "—"}</b>
        <span className="left">0</span><span className="right">100</span>
      </div>
      <strong>{riskLabel(score, lang)}</strong>
    </div>
  );
}

function MarketStructure({
  view,
  symbol,
  copy,
  lang,
}: {
  view: V2CommandCenterPageView;
  symbol: "SPY" | "QQQ";
  copy: MarketCopy;
  lang: V2Language;
}) {
  const g = gammaFor(view, symbol);
  const spot = g?.spot;
  const flip = g?.gammaFlip;
  const values = [g?.callWall, g?.putWall, flip, spot].filter((v): v is number => typeof v === "number");
  const min0 = values.length ? Math.min(...values) : 0;
  const max0 = values.length ? Math.max(...values) : 1;
  const span0 = Math.max(1, max0 - min0);
  const min = min0 - span0 * 1.6;
  const max = max0 + span0 * 1.6;
  const pct = (value: number | null | undefined) => value == null ? 50 : Math.max(2, Math.min(98, ((value - min) / (max - min)) * 100));
  const isNegative = g?.regime?.toLowerCase().includes("negative") ?? false;
  const state = describeMarketGammaState(g, lang);

  return (
    <section className="mk-card mk-structure">
      <div className="mk-section-head">
        <h2>{copy.structureTitle} ({symbol})</h2>
        <select value={symbol} readOnly aria-label={`${symbol} ${copy.marketStructure}`}><option>{symbol}</option></select>
      </div>
      <div className="mk-structure-content">
        <div className="mk-structure-values">
          <span>{copy.dealerFlow}<b className={isNegative ? "bad" : "good"}>{g?.netGex == null ? "—" : `${g.netGex < 0 ? "−" : "+"}$${Math.abs(g.netGex / 1e9).toFixed(2)}B`}</b></span>
          <span>{copy.gammaFlip}<b>{fmt(g?.gammaFlip, 1)}</b></span>
          <span>{copy.callWall}<b>{fmt(g?.callWall, 1)}</b></span>
          <span>{copy.putWall}<b>{fmt(g?.putWall, 1)}</b></span>
          <span>{copy.spot}<b>{fmt(g?.spot, 1)}</b></span>
        </div>
        <div className="mk-structure-chart">
          <div className="mk-zone-labels"><span className="bad">{copy.negativeGamma}</span><span>{copy.zeroGamma}</span><span className="good">{copy.positiveGamma}</span></div>
          <div className="mk-gamma-bar"><i className="neg"/><i className="pos"/><b className="flip" style={{ left: `${pct(flip)}%` }}/><b className="spot" style={{ left: `${pct(spot)}%` }}/></div>
          <div className="mk-axis-labels"><span>{fmt(min, 0)}</span><span>{fmt((min + max) / 2, 0)}</span><span>{fmt(max, 0)}</span></div>
          <strong className="mk-spot-caption">{copy.spot} {fmt(spot, 1)}</strong>
        </div>
      </div>
      <div className={`mk-state is-${state.kind}`} data-testid={`mk-state-${symbol}`}>
        <b>{state.title}</b><span>{state.note}</span>
      </div>
    </section>
  );
}

function SectorRotation({ view, copy }: { view: V2CommandCenterPageView; copy: MarketCopy }) {
  const rows = useMemo(
    () => [...view.sectorRotation.sectors].sort((a, b) => b.rs5d - a.rs5d).slice(0, 10),
    [view.sectorRotation.sectors],
  );
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.rs5d)));
  return (
    <section className="mk-card mk-rotation">
      <h2>{copy.rotationTitle} <small>{copy.vsSpy}</small></h2>
      <div className="mk-rotation-chart">
        {rows.map((row) => {
          const height = Math.max(8, (Math.abs(row.rs5d) / maxAbs) * 58);
          return (
            <div className="mk-rotation-col" key={row.symbol}>
              <b className={row.rs5d >= 0 ? "good" : "bad"}>{signed(row.rs5d)}</b>
              <div className="mk-rotation-barspace">
                <i className={row.rs5d >= 0 ? "positive" : "negative"} style={{ height: `${height}px` }} />
              </div>
              <strong>{row.symbol}</strong>
            </div>
          );
        })}
      </div>
      <div className="mk-rotation-footer"><span className="good">↑ &nbsp; {copy.leading}</span><span className="bad">{copy.weakening} &nbsp; ↓</span></div>
    </section>
  );
}

function RiskSnapshot({ view, copy }: { view: V2CommandCenterPageView; copy: MarketCopy }) {
  const trend = view.riskDivergenceTrend?.toUpperCase() ?? "—";
  const highBeta = view.allocation?.highBeta;
  const tilt = highBetaTilt(view.riskDivergence);
  const target =
    highBeta == null ? null : Math.round(Math.min(100, Math.max(0, highBeta + tilt)));
  const tiltLabel = `${tilt > 0 ? "+" : ""}${tilt}`;
  return (
    <section className="mk-card mk-risk-snapshot">
      <h2>{copy.riskSnapshot}</h2>
      <div className="mk-snapshot-body">
        <span>{copy.qqqSpySpread}</span>
        <strong className={view.riskDivergence != null && view.riskDivergence > 0 ? "bad" : "good"}>{formatRiskDivergenceValue(view.riskDivergence)}</strong>
        <b className={view.riskDivergenceTrend === "widening" ? "bad" : view.riskDivergenceTrend ? "good" : "neutral"}>{trend}</b>
        <small>
          {copy.highBeta}: {target == null ? "—" : `${copy.target} ${target}% · ${copy.tilt} ${tiltLabel}`}
          <span className="mk-alloc-note"> · {copy.riskBasedAlloc}</span>
        </small>
      </div>
    </section>
  );
}

export function MarketDetailPreview({
  view,
  manualGammaSnapshot,
  opportunityScoreV2,
  riskTrend,
  positioning,
}: {
  view: V2CommandCenterPageView;
  manualGammaSnapshot: ManualGammaSnapshot | null;
  opportunityScoreV2: number | null;
  riskTrend: RiskTrendV2Label | null;
  positioning: PositioningV2Label | null;
}) {
  const [manualOpen, setManualOpen] = useState(true);
  const [uiLang, setUiLang] = useState<V2Language>("en");
  const copy = uiLang === "zh" ? ZH : EN;
  const marketOpen = isUsEquityRegularSessionOpen();
  const policyNotes = interpretV2Policy(
    {
      riskScore: view.riskScore,
      opportunityScore: opportunityScoreV2,
      trend: riskTrend,
      positioning,
    },
    uiLang,
  );
  const aiStudyQualitative = localizeMarketAiStudySections(view.aiStudy, uiLang);
  const exposureMid = view.exposure ? Math.round((view.exposure.min + view.exposure.max) / 2) : null;
  const exposurePointer = exposureMid == null
    ? 0
    : Math.max(0, Math.min(100, (exposureMid / 150) * 100));
  const factorOrder = [
    ["breadth", copy.breadth],
    ["gamma", copy.gamma],
    ["vol", copy.volatility],
    ["macro", copy.macro],
    ["event_gate", copy.event],
  ] as const;
  const comparisonById = new Map((view.riskSessionComparison?.factors ?? []).map((row) => [row.id, row]));

  return (
    <div className="mk-app">
      <style>{styles}</style>
      <aside className="mk-nav">
        <div className="mk-brand"><strong>GammaDesk</strong><small>{copy.brandSub}</small></div>
        <nav>
          <a className="active" href="#top"><b>01</b><span>{copy.overview}</span></a>
          <a href="#structure"><b>02</b><span>{copy.marketStructure}</span></a>
          <a href="#structure"><b>03</b><span>{copy.indexGamma}<br/>(SPY/QQQ)</span></a>
          <a href="#rotation"><b>04</b><span>{copy.sectorRotation}</span></a>
          <a href="#ai-study"><b>05</b><span>{copy.aiStudy}</span></a>
          <a href="#daily-review"><b>06</b><span>{copy.dailyReview}</span></a>
        </nav>
      </aside>

      <div className="mk-shell" id="top">
        <header className="mk-top">
          <a href="/" className="mk-back" aria-label={copy.back}>‹</a>
          <div className="mk-date"><strong>{view.sessionDate ?? "—"}</strong><small>{copy.delayed}</small></div>
          <div className="mk-top-actions">
            <div className="mk-lang" aria-label={copy.language}>
              <button type="button" className={uiLang === "en" ? "active" : ""} onClick={() => setUiLang("en")}>EN</button>
              <span>|</span>
              <button type="button" className={uiLang === "zh" ? "active" : ""} onClick={() => setUiLang("zh")}>中文</button>
            </div>
            <span className={marketOpen ? "mk-session is-open" : "mk-session is-closed"}>
              {marketOpen ? `☀ ${copy.marketOpen}` : `● ${copy.marketClosed}`}
            </span>
            <button type="button" onClick={() => window.location.reload()}>↻ &nbsp; {copy.refresh}</button>
          </div>
        </header>

        <main className="mk-main">
          <div className="mk-center">
            <section className="mk-overview-row">
              <article className="mk-card mk-sentiment">
                <h2>{copy.sentiment}</h2>
                <RiskGauge score={view.riskScore} lang={uiLang}/>
                {view.riskChange != null ? <small className={view.riskChange <= 0 ? "good" : "bad"}>{view.riskChange <= 0 ? "↓" : "↑"} {Math.abs(view.riskChange)} {copy.vsYesterday}</small> : null}
                <div className="mk-v2-metrics" data-testid="mk-v2-metrics">
                  <span>{copy.riskScore}<b>{view.riskScore ?? "—"}</b></span>
                  <span>{copy.opportunity}<b>{opportunityScoreV2 ?? "—"}</b></span>
                  <span>{copy.trend}<b>{riskTrend ?? "—"}</b></span>
                  <span>{copy.positioning}<b>{positioning ?? "—"}</b></span>
                </div>
                <ul className="mk-v2-notes" data-testid="mk-v2-notes">
                  {policyNotes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </article>
              <article className="mk-card mk-exposure"><h2>{copy.exposure}</h2><p>{copy.overallExposure}</p><strong>{exposureMid == null ? "—" : `${exposureMid}%`}</strong><small>{exposureMid == null || !view.exposure ? copy.unavailable : `${copy.exposureBand} ${view.exposure.min}–${view.exposure.max}%`}</small><div className="mk-exposure-bar"><i/><b style={{ left: `${exposurePointer}%` }}/></div><div className="mk-exposure-labels"><span>0%</span><span>75%</span><span>150%</span></div></article>
            </section>

            <section className="mk-card mk-drivers">
              <div className="mk-section-head"><h2>{copy.drivers}</h2><small>{copy.driversNote}</small></div>
              <div className="mk-driver-grid">
                {factorOrder.map(([id, label]) => {
                  const factor = comparisonById.get(id);
                  const score = factor?.todayScore ?? null;
                  const signal = factorSignal(view, id);
                  const tone = factorTone(id, signal);
                  const width = score == null ? 15 : Math.max(8, Math.min(100, score));
                  return <div className="mk-driver" key={id}><div><span>{tone === "good" ? "↑" : tone === "bad" ? "↓" : "—"}</span><b>{label}</b><em>{score == null ? "—" : Math.round(score)}</em></div><i><b className={tone} style={{ width: `${width}%` }}/></i></div>;
                })}
              </div>
            </section>

            <div id="structure"><MarketStructure view={view} symbol="SPY" copy={copy} lang={uiLang}/></div>
            <MarketStructure view={view} symbol="QQQ" copy={copy} lang={uiLang}/>
            <div className="mk-bottom-grid" id="rotation"><SectorRotation view={view} copy={copy}/><RiskSnapshot view={view} copy={copy}/></div>
            <div className="mk-data-line">{copy.dataAsOf} {view.sessionDate ?? "—"} &nbsp; • &nbsp; {copy.priceDelayed} &nbsp; • &nbsp; {copy.sourceManual}</div>
          </div>

          <aside className="mk-right">
            <section className="mk-ai" id="ai-study">
              <div className="mk-rail-head"><h2>✦ {copy.aiStudy.toUpperCase()}</h2><small>{copy.aiGenerated}</small></div>
              <h3>{copy.keyTakeaway}</h3><p>{view.aiStudy.baseCase}</p>
              <h3>{copy.whatToWatch}</h3><ul>{view.gamma.slice(0, 2).map((g) => <li key={g.symbol}><b>{g.symbol}</b> · {copy.gammaFlip} {fmt(g.gammaFlip)} · {copy.callWall} {fmt(g.callWall)} · {copy.putWall} {fmt(g.putWall)}</li>)}</ul>
              <div className="mk-ai-section"><h3>{copy.primaryRisks}</h3><p>{view.aiStudy.invalidation}</p></div>
              <div className="mk-ai-section"><h3>{copy.opportunities}</h3><p>{view.aiStudy.ifThen}</p></div>
              <div className="mk-ai-section"><h3>{copy.hiddenRisk}</h3><p>{aiStudyQualitative.hiddenRisk}</p></div>
              <div className="mk-ai-section"><h3>{copy.reactionQuality}</h3><p>{aiStudyQualitative.reactionQuality}</p></div>
              <div className="mk-ai-section"><h3>{copy.crossAssetConflict}</h3><p>{aiStudyQualitative.crossAssetConflict}</p></div>
              <div className="mk-ai-section"><h3>{copy.whatChanged}</h3><p>{aiStudyQualitative.whatChanged}</p></div>
              <div className="mk-ai-section"><h3>{copy.whatMattersNext}</h3><p>{aiStudyQualitative.whatMattersNext}</p></div>
            </section>

            <section className="mk-review" id="daily-review">
              <div className="mk-rail-head"><h2>06 &nbsp; {copy.dailyReview.toUpperCase()}</h2><a href="#">{copy.viewAll}</a></div>
              <div className="mk-review-row"><time>4:10 PM</time><p>{view.dailyReview.whatWorked[0] ?? copy.reviewPendingStructure}</p><span>{copy.marketStructure}</span></div>
              <div className="mk-review-row"><time>3:45 PM</time><p>{view.dailyReview.whatFailed[0] ?? copy.reviewPendingVol}</p><span>{copy.volatility}</span></div>
              <div className="mk-review-row"><time>2:30 PM</time><p>{view.dailyReview.tomorrowWatch[0] ?? copy.reviewPendingBreadth}</p><span>{copy.breadth}</span></div>
              <div className="mk-review-row"><time>9:50 AM</time><p>{view.macroSummary?.label ?? copy.reviewPendingMacro}</p><span>{copy.macro}</span></div>
            </section>
          </aside>
        </main>
      </div>

      {manualOpen ? <ManualGammaPanel view={view} snapshot={manualGammaSnapshot} copy={copy} onClose={() => setManualOpen(false)}/> : <button type="button" className="mk-open-manual" onClick={() => setManualOpen(true)}>{copy.openManual}</button>}
    </div>
  );
}

const styles = `
:root{--mk-blue:#004fff;--mk-text:#142347;--mk-muted:#6e7890;--mk-line:#dce5f0;--mk-good:#0b9b55;--mk-bad:#ef3e43;--mk-yellow:#e7aa12}
*{box-sizing:border-box}.mk-app{min-height:100vh;background:#fff;color:var(--mk-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:190px 1fr;font-size:12px}.mk-nav{border-right:1px solid var(--mk-line);background:#fff;height:100vh;position:sticky;top:0;z-index:5}.mk-brand{height:92px;padding:18px 20px;border-bottom:1px solid var(--mk-line);display:flex;flex-direction:column;gap:5px}.mk-brand strong{font-size:17px;color:var(--mk-blue)}.mk-brand small{font-size:9px;color:var(--mk-muted)}.mk-nav nav{display:grid;padding-top:7px}.mk-nav a{display:grid;grid-template-columns:30px 1fr;gap:8px;align-items:center;padding:13px 18px;text-decoration:none;color:#243455;border-left:3px solid transparent;font-size:10px}.mk-nav a b{color:#7894c9}.mk-nav a.active{color:var(--mk-blue);background:#f1f6ff;border-left-color:var(--mk-blue);font-weight:700}.mk-nav a.active b{color:var(--mk-blue)}.mk-shell{min-width:0}.mk-top{height:78px;border-bottom:1px solid var(--mk-line);display:grid;grid-template-columns:32px 1fr auto;align-items:center;padding:0 18px;background:#fff}.mk-back{font-size:31px;line-height:1;text-decoration:none;color:var(--mk-blue);font-weight:300}.mk-date{display:flex;flex-direction:column;gap:4px}.mk-date strong{font-size:11px;color:#17243e}.mk-date small{font-size:9px;color:var(--mk-muted)}.mk-top-actions{display:flex;align-items:center;gap:18px}.mk-lang{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800}.mk-lang button{border:0;background:transparent;padding:0;color:var(--mk-muted);cursor:pointer;font:inherit}.mk-lang button.active{color:var(--mk-blue)}.mk-lang>span{color:#c5cedb;font-weight:600}.mk-session{font-weight:700}.mk-session.is-open{color:var(--mk-good)}.mk-session.is-closed{color:var(--mk-muted)}.mk-top-actions>button{border:1px solid var(--mk-line);background:#fff;border-radius:6px;padding:9px 15px;font-weight:700;color:#283650}.mk-main{display:grid;grid-template-columns:minmax(700px,1fr) 330px;gap:10px;padding:10px;background:#fff}.mk-center{min-width:0}.mk-card{border:1px solid var(--mk-line);border-radius:8px;background:#fff}.mk-card h2,.mk-right h2{font-size:11px;margin:0;color:var(--mk-blue);font-weight:800}.mk-overview-row{display:grid;grid-template-columns:1fr 1.2fr;gap:0}.mk-overview-row>.mk-card{min-height:260px;border-radius:0}.mk-overview-row>.mk-card:first-child{border-radius:8px 0 0 8px}.mk-overview-row>.mk-card:last-child{border-radius:0 8px 8px 0;border-left:0}.mk-sentiment,.mk-exposure{padding:18px 20px}.mk-risk-wrap{text-align:center;margin-top:15px}.mk-gauge{width:270px;height:150px;margin:0 auto;position:relative;overflow:hidden}.mk-gauge-arc{position:absolute;left:15px;top:11px;width:240px;height:240px;border-radius:50%;background:conic-gradient(from 270deg,#ef4b42 0 42deg,#ff9e21 42deg 88deg,#e7cf39 88deg 127deg,#8fc664 127deg 153deg,#28a65a 153deg 180deg,transparent 180deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 13px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 13px),#000 0)}.mk-gauge-needle{position:absolute;left:50%;bottom:30px;width:76px;height:2px;background:#1c222d;transform-origin:0 50%;transform:rotate(var(--mk-risk-angle));z-index:2}.mk-gauge-pivot{position:absolute;left:calc(50% - 4px);bottom:26px;width:8px;height:8px;border-radius:50%;background:#1c222d;z-index:3}.mk-gauge>b{position:absolute;left:0;right:0;bottom:35px;font-size:31px;color:#111}.mk-gauge .left,.mk-gauge .right{position:absolute;bottom:9px;font-size:8px;color:var(--mk-muted)}.mk-gauge .left{left:15px}.mk-gauge .right{right:15px}.mk-risk-wrap>strong{display:block;color:#d68809;font-size:11px;margin-top:1px}.mk-sentiment>small{display:block;text-align:center;margin-top:6px;font-size:9px;font-weight:700}.mk-v2-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;border-top:1px solid var(--mk-line);padding-top:10px}.mk-v2-metrics span{display:grid;gap:3px;text-align:center;font-size:8px;color:var(--mk-muted);font-weight:700}.mk-v2-metrics b{font-size:11px;color:var(--mk-text);text-transform:none}.mk-v2-notes{list-style:none;margin:10px 0 0;padding:8px 0 0;border-top:1px dashed #e4ebf3}.mk-v2-notes li{font-size:8px;line-height:1.45;color:#7a8498;font-weight:500;padding:2px 0}.mk-exposure{text-align:center}.mk-exposure h2{text-align:left}.mk-exposure>p{font-size:13px;color:#566078;margin:30px 0 10px}.mk-exposure>strong{display:block;font-size:34px;color:#111}.mk-exposure>small{display:block;color:var(--mk-muted);margin-top:5px}.mk-exposure-bar{height:8px;margin:40px 25px 8px;position:relative;border-radius:99px;background:#e8edf3}.mk-exposure-bar b{position:absolute;top:-4px;width:8px;height:16px;border-radius:6px;background:#333;transform:translateX(-50%)}.mk-exposure-labels{display:flex;justify-content:space-between;margin:0 20px;font-size:9px;font-weight:700}.mk-exposure-labels span{color:var(--mk-muted)}.mk-drivers{margin-top:10px;padding:14px 18px}.mk-section-head{display:flex;justify-content:space-between;align-items:center}.mk-section-head small{color:var(--mk-muted);font-size:9px}.mk-driver-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin-top:18px}.mk-driver>div{display:grid;grid-template-columns:15px 1fr auto;gap:4px;align-items:center;font-size:9px}.mk-driver>div span{font-weight:900}.mk-driver>div em{font-style:normal;font-weight:700}.mk-driver>i{display:block;height:6px;background:#e8edf3;border-radius:99px;overflow:hidden;margin-top:9px}.mk-driver>i b{display:block;height:100%;background:#aeb8c7}.mk-driver>i b.good{background:var(--mk-good)}.mk-driver>i b.bad{background:var(--mk-bad)}.mk-driver>i b.neutral{background:#aeb8c7}.mk-structure{margin-top:10px;padding:14px 18px}.mk-structure .mk-section-head select{border:1px solid var(--mk-line);background:#fff;border-radius:5px;padding:6px 10px;color:#2d3a57}.mk-structure-content{display:grid;grid-template-columns:250px 1fr;gap:40px;align-items:center;margin-top:15px}.mk-structure-values{display:grid;gap:12px}.mk-structure-values span{display:flex;justify-content:space-between;font-size:10px}.mk-structure-values b{font-size:10px}.mk-structure-chart{padding:0 15px}.mk-zone-labels{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;font-size:8px;font-weight:700;margin-bottom:9px}.mk-gamma-bar{position:relative;height:15px;border-radius:3px;background:#edf1f5}.mk-gamma-bar i{position:absolute;top:0;bottom:0;width:50%}.mk-gamma-bar .neg{left:0;background:linear-gradient(90deg,#ff8c90,#f8d8da)}.mk-gamma-bar .pos{right:0;background:linear-gradient(90deg,#d8efe0,#92d7af)}.mk-gamma-bar b{position:absolute;z-index:2;transform:translateX(-50%)}.mk-gamma-bar .flip{top:-11px;height:36px;border-left:1px dashed #45536b}.mk-gamma-bar .spot{top:-5px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid #151a23}.mk-axis-labels{display:flex;justify-content:space-between;font-size:8px;color:var(--mk-muted);margin-top:8px}.mk-spot-caption{display:block;text-align:center;font-size:9px;margin-top:4px}.mk-state{display:flex;gap:30px;align-items:center;background:#f4f6f9;border-radius:5px;padding:9px 12px;margin-top:14px;font-size:9px}.mk-state b{color:#6e7890}.mk-state span{color:#39475d}.mk-state.is-stabilizing{background:#f2f8f4}.mk-state.is-stabilizing b{color:#1f7547}.mk-state.is-transition{background:#fff8e8}.mk-state.is-transition b{color:#c48a10}.mk-state.is-amplifying{background:#fef2f2}.mk-state.is-amplifying b{color:#ef3e43}.mk-bottom-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.75fr);gap:10px;margin-top:10px}.mk-rotation{padding:14px 18px;margin:0}.mk-rotation h2 small{font-size:9px}.mk-rotation-chart{height:150px;border-bottom:1px solid #d9e1eb;display:grid;grid-template-columns:repeat(10,1fr);gap:10px;align-items:end;margin-top:10px;padding:0 10px}.mk-rotation-col{text-align:center;display:grid;grid-template-rows:18px 95px 18px;align-items:end}.mk-rotation-col>b{font-size:8px}.mk-rotation-barspace{height:95px;position:relative;display:flex;align-items:center;justify-content:center}.mk-rotation-barspace:after{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px solid #e8edf2}.mk-rotation-barspace i{width:28px;z-index:1}.mk-rotation-barspace i.positive{background:#63ba8b;align-self:center;transform:translateY(calc(-50% - 1px))}.mk-rotation-barspace i.negative{background:#ef7679;align-self:center;transform:translateY(calc(50% + 1px))}.mk-rotation-col>strong{font-size:9px}.mk-rotation-footer{display:flex;justify-content:space-between;padding:12px 45px 0;font-size:10px;font-weight:700}.mk-risk-snapshot{padding:14px 18px;min-height:215px}.mk-snapshot-body{text-align:center;display:grid;gap:10px;padding:22px 10px 0}.mk-snapshot-body>span{font-size:13px;font-weight:700}.mk-snapshot-body>strong{font-size:38px;line-height:1;margin-top:4px}.mk-snapshot-body>b{font-size:13px}.mk-snapshot-body>small{border-top:1px solid var(--mk-line);padding-top:13px;font-size:13px}.mk-alloc-note{display:block;margin-top:4px;font-size:8px;font-weight:600;color:var(--mk-muted);text-transform:none}.mk-snapshot-body em{font-style:normal;font-weight:800}.mk-data-line{padding:10px 18px;font-size:8px;color:var(--mk-muted);border-top:1px solid #eef2f6}.mk-right{background:#f8fbff;border-left:1px solid #e5edf7;display:grid;grid-template-rows:auto 1fr;align-content:start}.mk-ai,.mk-review{padding:18px;border-bottom:1px solid var(--mk-line)}.mk-rail-head{display:flex;justify-content:space-between;align-items:center}.mk-rail-head small{font-size:8px;color:var(--mk-muted)}.mk-ai h3{font-size:9px;margin:24px 0 7px;color:#203257}.mk-ai p,.mk-ai li{font-size:10px;line-height:1.65;color:#283755}.mk-ai ul{padding-left:17px}.mk-ai-section{border-top:1px solid var(--mk-line);margin:18px -18px 0;padding:3px 18px 0}.mk-review h2{font-size:13px}.mk-review a{font-size:8px;color:var(--mk-blue);text-decoration:none}.mk-review-row{display:grid;grid-template-columns:48px 1fr auto;gap:8px;align-items:start;padding:13px 0;border-bottom:1px solid #e7edf5}.mk-review-row time{font-size:8px}.mk-review-row p{font-size:9px;line-height:1.5;margin:0}.mk-review-row span{font-size:7px;color:var(--mk-blue);background:#edf4ff;padding:4px 6px;border-radius:4px}.mk-manual-panel{position:fixed;left:0;bottom:0;width:235px;background:#fff;border:1px solid var(--mk-line);box-shadow:0 4px 20px rgba(26,45,78,.16);z-index:20;padding:12px 12px 10px}.mk-manual-head{display:flex;justify-content:space-between;align-items:center}.mk-manual-head h3{font-size:9px;margin:0}.mk-manual-head button{border:0;background:transparent;font-size:18px;color:#647087;cursor:pointer}.mk-source{display:grid;gap:5px;margin-top:12px;font-size:8px}.mk-source select,.mk-manual-panel input,.mk-manual-panel textarea{width:100%;border:1px solid #d9e2ee;border-radius:4px;padding:6px;font:inherit;color:inherit;background:#fff}.mk-manual-symbols{display:grid;grid-template-columns:1fr 54px 54px;gap:7px;margin:12px 0 5px;font-size:8px;color:var(--mk-blue)}.mk-manual-symbols b:first-child{grid-column:2}.mk-manual-row{display:grid;grid-template-columns:1fr 54px 54px;gap:7px;align-items:center;margin:5px 0;font-size:8px}.mk-manual-wide{display:grid;gap:5px;margin-top:9px;font-size:8px}.mk-manual-actions{display:grid;grid-template-columns:1fr 1.25fr;gap:8px;margin-top:10px}.mk-manual-actions button{border-radius:4px;padding:8px;font-size:8px;font-weight:700}.mk-manual-actions .secondary{background:#fff;border:1px solid var(--mk-line);color:#25344f}.mk-manual-actions .primary{background:var(--mk-blue);border:1px solid var(--mk-blue);color:#fff}.mk-open-manual{position:fixed;left:12px;bottom:12px;z-index:20;border:0;border-radius:5px;background:var(--mk-blue);color:#fff;padding:8px 10px;font-size:8px;font-weight:700}.good{color:var(--mk-good)!important}.bad{color:var(--mk-bad)!important}.neutral{color:#78849a!important}@media(max-width:1180px){.mk-main{grid-template-columns:1fr}.mk-right{grid-template-columns:1fr 1fr;border-left:0}.mk-driver-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:850px){.mk-app{grid-template-columns:72px 1fr}.mk-brand{padding:18px 10px}.mk-brand strong{font-size:11px}.mk-brand small,.mk-nav a span{display:none}.mk-nav a{grid-template-columns:1fr;text-align:center;padding:12px 6px}.mk-overview-row{grid-template-columns:1fr}.mk-overview-row>.mk-card{border-radius:8px!important;border:1px solid var(--mk-line)!important}.mk-structure-content{grid-template-columns:1fr}.mk-driver-grid{grid-template-columns:repeat(2,1fr)}.mk-right{grid-template-columns:1fr}.mk-bottom-grid{grid-template-columns:1fr}.mk-rotation-chart{overflow-x:auto}.mk-manual-panel{width:220px}}
`;
