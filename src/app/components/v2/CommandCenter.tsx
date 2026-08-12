import type { ReactNode } from "react";
import type {
  V2CommandCenterView,
  V2GammaSummary,
  V2Language,
  V2SpyBreadthSummary,
} from "@/desk";
import { breadthSignalLabel } from "@/desk/v2-command-center";
import {
  ctaProxySignalLabel,
  formatGexCompact,
  formatIvHvSpreadVolPts,
  formatRestOfDayRangeLabel,
  formatVolMispricingPct,
  volMispricingSignalLabel,
  type VolMispricingSummary,
} from "@/desk/format-gamma";

const copy = {
  en: {
    product: "GammaDesk",
    subtitle: "Daily Market Decision Copilot",
    overview: "Overview",
    structure: "Market Structure",
    flow: "Flow / Participation",
    macro: "Macro Focus",
    rotation: "Rotation",
    study: "AI Study",
    review: "Daily Review",
    preview: "Illustrative methodology preview · synthetic decision values",
    liveReady: "Live decision from connected inputs · review evidence and missing fields",
    liveBlocked: "Live decision withheld · required inputs are not connected",
    stance: "Daily stance",
    stanceBuy: "Buy",
    stanceHold: "Hold",
    stanceReduce: "Reduce",
    awaiting: "Awaiting inputs",
    risk: "Portfolio risk",
    vsYesterday: "vs yesterday",
    opportunity: "Dip opportunity",
    exposure: "Suggested exposure",
    gamma: "SPY / QQQ gamma",
    breadth: "Breadth",
    breadthSignalNote: "SPY ETF holdings · not full market breadth",
    breadthDetail: "Holdings detail",
    ctaProxy: "CTA proxy",
    ctaProxyNote: "Systematic trend proxy · not dealer positioning",
    volMispricing: "Vol mispricing",
    volMispricingNote: "Options IV vs HV20",
    session: "Session",
    asOf: "As-of",
    advance: "Advance",
    decline: "Decline",
    unchanged: "Unchanged",
    aboveMa20: "> MA20",
    aboveMa50: "> MA50",
    new20dHighs: "20D highs",
    new20dLows: "20D lows",
    stale: "Stale",
    spot: "Spot",
    putWall: "Put wall",
    callWall: "Call wall",
    restOfDayRange: "ROD 90%",
    iv: "IV",
    hv20: "HV20",
    ivMinusHv: "IV − HV",
    corridor: "Corridor",
    netGex: "Net GEX",
    gammaFlipLevel: "Gamma flip",
    dealerFlow: "Dealer flow",
    unavailable: "Unavailable",
    allocation: "Risk allocation map",
    highBeta: "High beta",
    defense: "Defense",
    metals: "Metals",
    hedge: "Hedge",
    why: "Why this view",
    missing: "Required before live output",
    macroFocus: "Macro focus",
    noMacro: "No aligned macro snapshot",
    bounded: "Bounded",
    details: "Data quality & source",
    wallTouch: "touch",
  },
  zh: {
    product: "GammaDesk",
    subtitle: "每日市场决策 Copilot",
    overview: "总览",
    structure: "市场结构",
    flow: "流向 / 参与度",
    macro: "宏观重点",
    rotation: "板块轮动",
    study: "AI 研究",
    review: "每日复盘",
    preview: "方法论预览 · 决策数值为明确标注的模拟数据",
    liveReady: "已接入输入的实时决策 · 请结合依据与缺失项审阅",
    liveBlocked: "实时决策暂不输出 · 必要输入尚未接通",
    stance: "今日操作",
    stanceBuy: "买入",
    stanceHold: "持有",
    stanceReduce: "减仓",
    awaiting: "等待数据",
    risk: "组合风险",
    vsYesterday: "较昨日",
    opportunity: "回调机会",
    exposure: "建议仓位",
    gamma: "SPY / QQQ Gamma",
    breadth: "广度",
    breadthSignalNote: "SPY ETF 持仓 · 非全市场广度",
    breadthDetail: "持仓明细",
    ctaProxy: "CTA 代理",
    ctaProxyNote: "系统化趋势代理 · 非做市商持仓",
    volMispricing: "波动率错价",
    volMispricingNote: "期权 IV vs HV20",
    session: "交易日",
    asOf: "截至",
    advance: "上涨",
    decline: "下跌",
    unchanged: "持平",
    aboveMa20: "> MA20",
    aboveMa50: "> MA50",
    new20dHighs: "20 日新高",
    new20dLows: "20 日新低",
    stale: "滞后",
    spot: "现货",
    putWall: "Put Wall",
    callWall: "Call Wall",
    restOfDayRange: "日内 90%",
    iv: "IV",
    hv20: "HV20",
    ivMinusHv: "IV − HV",
    corridor: "双墙区间",
    netGex: "净 GEX",
    gammaFlipLevel: "Gamma 翻转",
    dealerFlow: "做市商流向",
    unavailable: "不可用",
    allocation: "风险配置地图",
    highBeta: "高 Beta",
    defense: "防御",
    metals: "金属",
    hedge: "对冲",
    why: "判断依据",
    missing: "实时输出前仍需接入",
    macroFocus: "今日宏观重点",
    noMacro: "没有时间对齐的宏观快照",
    bounded: "有限范围",
    details: "数据质量与来源",
    wallTouch: "触及",
  },
} as const;

function formatLevel(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : value.toFixed(value % 1 === 0 ? 0 : 1);
}

function formatMetric(value: number | null): string {
  if (value === null) return "—";
  return `${value}%`;
}

function wallTouchPercentLabel(
  touch: V2GammaSummary["callWallTouch"],
): string | null {
  if (touch.status !== "available" || touch.percent === null) {
    return null;
  }
  return `${touch.percent}%`;
}

export function collectStructureAxisValues(item: V2GammaSummary): number[] {
  const values: number[] = [];
  if (item.spot !== null) values.push(item.spot);
  if (item.putWall !== null) values.push(item.putWall);
  if (item.callWall !== null) values.push(item.callWall);
  if (item.gammaFlip !== null) values.push(item.gammaFlip);
  if (item.restOfDayRange.status === "available") {
    if (item.restOfDayRange.lower !== null) values.push(item.restOfDayRange.lower);
    if (item.restOfDayRange.upper !== null) values.push(item.restOfDayRange.upper);
  }
  return values;
}

export function structureAxisScale(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = min >= 100 ? 5 : 1;
    return { min: min - pad, max: max + pad };
  }
  const span = max - min;
  const pad = Math.max(span * 0.08, max >= 100 ? 2 : 0.5);
  return { min: min - pad, max: max + pad };
}

export function structureAxisPercent(
  value: number,
  scale: { min: number; max: number },
): number {
  const span = scale.max - scale.min;
  if (span <= 0) return 50;
  return ((value - scale.min) / span) * 100;
}

const STRUCTURE_AXIS_COLLISION_PCT = 11;

export function assignStructureAxisLanes(
  items: readonly { id: string; leftPct: number }[],
  threshold = STRUCTURE_AXIS_COLLISION_PCT,
): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.leftPct - b.leftPct);
  const lanes: { id: string; leftPct: number }[][] = [];
  const out: Record<string, number> = {};

  for (const item of sorted) {
    let laneIdx = 0;
    while (
      laneIdx < lanes.length &&
      lanes[laneIdx]!.some(
        (marker) => Math.abs(marker.leftPct - item.leftPct) < threshold,
      )
    ) {
      laneIdx++;
    }
    if (laneIdx >= lanes.length) lanes.push([]);
    lanes[laneIdx]!.push(item);
    out[item.id] = laneIdx;
  }

  return out;
}

function structureAxisFlipLabelOffset(
  flipPct: number,
  spotPct: number | null,
  threshold = STRUCTURE_AXIS_COLLISION_PCT,
): "left" | "right" | null {
  if (spotPct === null) return null;
  if (Math.abs(flipPct - spotPct) >= threshold) return null;
  return flipPct < spotPct ? "left" : "right";
}

function StructureAxisMarker({
  leftPct,
  tone,
  label,
  value,
  placement,
  lane = 0,
  flipLabelOffset = null,
  touchLabel,
  testId,
  valueTestId,
}: {
  leftPct: number;
  tone: "put" | "call" | "flip" | "spot";
  label: string;
  value: string;
  placement: "above" | "below" | "flip";
  lane?: number;
  flipLabelOffset?: "left" | "right" | null;
  touchLabel?: string | null;
  testId?: string;
  valueTestId?: string;
}) {
  const laneClass = lane > 0 ? ` is-lane-${lane}` : "";
  const offsetClass =
    placement === "flip" && flipLabelOffset ? ` is-offset-${flipLabelOffset}` : "";

  return (
    <div
      className={`v2-structure-axis-marker is-${tone} is-${placement}${laneClass}${offsetClass}`}
      style={{ left: `${leftPct}%` }}
      data-testid={testId}
    >
      {placement === "above" ? (
        <>
          <span className="v2-structure-axis-marker-label">{label}</span>
          <strong className="v2-structure-axis-marker-value" data-testid={valueTestId}>
            {value}
          </strong>
          <span className="v2-structure-axis-tick" />
        </>
      ) : placement === "below" ? (
        <>
          <span className="v2-structure-axis-tick" />
          <span className="v2-structure-axis-marker-label">{label}</span>
          <strong className="v2-structure-axis-marker-value" data-testid={valueTestId}>
            {value}
          </strong>
          {touchLabel ? (
            <span className="v2-structure-axis-touch">{touchLabel}</span>
          ) : null}
        </>
      ) : (
        <>
          <span className="v2-structure-axis-tick" />
          <div className="v2-structure-axis-flip-label">
            <span className="v2-structure-axis-marker-label">{label}</span>
            <strong className="v2-structure-axis-marker-value" data-testid={valueTestId}>
              {value}
            </strong>
          </div>
        </>
      )}
    </div>
  );
}

function StructureAxis({
  item,
  lang,
}: {
  item: V2GammaSummary;
  lang: V2Language;
}) {
  const t = copy[lang];
  const scale = structureAxisScale(collectStructureAxisValues(item));
  if (!scale) return null;

  const pct = (value: number) => structureAxisPercent(value, scale);
  const spotPct = item.spot !== null ? pct(item.spot) : null;
  const belowLaneItems: { id: string; leftPct: number }[] = [];
  if (item.putWall !== null) {
    belowLaneItems.push({ id: "put", leftPct: pct(item.putWall) });
  }
  if (item.callWall !== null) {
    belowLaneItems.push({ id: "call", leftPct: pct(item.callWall) });
  }
  const belowLanes = assignStructureAxisLanes(belowLaneItems);

  const flipPct =
    item.gammaFlip !== null ? pct(item.gammaFlip) : null;
  const flipLabelOffset =
    flipPct !== null ? structureAxisFlipLabelOffset(flipPct, spotPct) : null;

  const rod =
    item.restOfDayRange.status === "available" &&
    item.restOfDayRange.lower !== null &&
    item.restOfDayRange.upper !== null
      ? {
          left: pct(item.restOfDayRange.lower),
          width: pct(item.restOfDayRange.upper) - pct(item.restOfDayRange.lower),
        }
      : null;

  return (
    <div
      className="v2-structure-axis"
      data-testid={`v2-gamma-${item.symbol}-structure-axis`}
      aria-label={`${item.symbol} structure axis`}
    >
      <div className="v2-structure-axis-track">
        <div className="v2-structure-axis-core">
          <div className="v2-structure-axis-rail" />
          {rod ? (
            <div
              className="v2-structure-axis-rod"
              style={{ left: `${rod.left}%`, width: `${rod.width}%` }}
              data-testid={`v2-gamma-${item.symbol}-rod-band`}
            />
          ) : null}
        </div>
        {item.spot !== null ? (
          <StructureAxisMarker
            leftPct={pct(item.spot)}
            tone="spot"
            label={t.spot}
            value={formatLevel(item.spot)}
            placement="above"
          />
        ) : null}
        {item.gammaFlip !== null ? (
          <StructureAxisMarker
            leftPct={pct(item.gammaFlip)}
            tone="flip"
            label={t.gammaFlipLevel}
            value={formatLevel(item.gammaFlip)}
            placement="flip"
            flipLabelOffset={flipLabelOffset}
            valueTestId={`v2-gamma-${item.symbol}-flip`}
          />
        ) : null}
        {item.putWall !== null ? (
          <StructureAxisMarker
            leftPct={pct(item.putWall)}
            tone="put"
            label={t.putWall}
            value={formatLevel(item.putWall)}
            placement="below"
            lane={belowLanes.put ?? 0}
            touchLabel={wallTouchPercentLabel(item.putWallTouch)}
            testId={`v2-gamma-${item.symbol}-put-touch`}
          />
        ) : null}
        {item.callWall !== null ? (
          <StructureAxisMarker
            leftPct={pct(item.callWall)}
            tone="call"
            label={t.callWall}
            value={formatLevel(item.callWall)}
            placement="below"
            lane={belowLanes.call ?? 0}
            touchLabel={wallTouchPercentLabel(item.callWallTouch)}
            testId={`v2-gamma-${item.symbol}-call-touch`}
          />
        ) : null}
      </div>
    </div>
  );
}

function volSignalClass(signal: VolMispricingSummary["signal"]): string {
  switch (signal) {
    case "vol_expensive":
      return "is-vol-expensive";
    case "vol_underpriced":
      return "is-vol-underpriced";
    case "balanced":
      return "is-balanced";
    default:
      return "is-unavailable";
  }
}

function FlowSignalMetrics({ children }: { children: ReactNode }) {
  return <div className="v2-flow-metrics">{children}</div>;
}

function BreadthFlowCard({
  breadth,
  lang,
}: {
  breadth: V2SpyBreadthSummary;
  lang: V2Language;
}) {
  const t = copy[lang];
  const signalLabel = breadthSignalLabel(
    breadth.breadthSignal,
    breadth.breadthSignalStatus,
  );
  const ready = breadth.status === "available" || breadth.status === "partial";

  return (
    <article
      className="v2-flow-card"
      data-testid="v2-breadth-signal"
      aria-label={t.breadth}
    >
      <div className="v2-flow-card-head">
        <p className="v2-flow-label">{t.breadth}</p>
        <p className="v2-flow-note">{t.breadthSignalNote}</p>
        {breadth.stale ? (
          <span className="v2-flow-badge is-stale" data-testid="v2-breadth-signal-stale">
            {t.stale}
          </span>
        ) : null}
      </div>
      <strong
        className={`v2-flow-signal is-${breadth.breadthSignal ?? "unavailable"}`}
        data-testid="v2-breadth-signal-label"
      >
        {signalLabel}
      </strong>
      <FlowSignalMetrics>
        <span>{t.aboveMa20}</span>
        <strong data-testid="v2-breadth-signal-ma20">
          {formatMetric(breadth.percentAboveMA20)}
        </strong>
        <span>{t.aboveMa50}</span>
        <strong data-testid="v2-breadth-signal-ma50">
          {formatMetric(breadth.percentAboveMA50)}
        </strong>
      </FlowSignalMetrics>
      {ready ? (
        <details className="v2-flow-details">
          <summary>{t.breadthDetail}</summary>
          <div className="v2-breadth-meta">
            <span>{t.session}</span>
            <strong data-testid="v2-spy-breadth-session">
              {breadth.marketSessionDate ?? "—"}
            </strong>
            <span>{t.asOf}</span>
            <strong data-testid="v2-spy-breadth-asof">{breadth.asOf ?? "—"}</strong>
          </div>
          <div className="v2-breadth-grid">
            <div>
              <span>{t.advance}</span>
              <strong data-testid="v2-spy-breadth-advance">{breadth.advance ?? "—"}</strong>
            </div>
            <div>
              <span>{t.decline}</span>
              <strong data-testid="v2-spy-breadth-decline">{breadth.decline ?? "—"}</strong>
            </div>
            <div>
              <span>{t.unchanged}</span>
              <strong>{breadth.unchanged ?? "—"}</strong>
            </div>
            <div>
              <span>{t.new20dHighs}</span>
              <strong data-testid="v2-spy-breadth-highs">
                {formatMetric(breadth.new20DayClosingHigh)}
              </strong>
            </div>
            <div>
              <span>{t.new20dLows}</span>
              <strong data-testid="v2-spy-breadth-lows">
                {formatMetric(breadth.new20DayClosingLow)}
              </strong>
            </div>
          </div>
          {breadth.missingReason ? (
            <p className="v2-breadth-note" data-testid="v2-spy-breadth-reason">
              {breadth.missingReason}
            </p>
          ) : null}
          {breadth.sourceArtifact ? (
            <p className="v2-breadth-source">{breadth.sourceArtifact}</p>
          ) : null}
        </details>
      ) : (
        <p className="v2-breadth-missing" data-testid="v2-spy-breadth-reason">
          {breadth.missingReason ?? "—"}
        </p>
      )}
      <span
        className="v2-flow-status is-hidden"
        data-testid="v2-breadth-signal-status"
        hidden
      >
        {breadth.status}
      </span>
    </article>
  );
}

function CtaFlowCard({
  ctaProxy,
  lang,
}: {
  ctaProxy: V2CommandCenterView["ctaProxy"];
  lang: V2Language;
}) {
  const t = copy[lang];
  const signalLabel = ctaProxySignalLabel(ctaProxy.signal, ctaProxy.status);

  return (
    <article
      className="v2-flow-card"
      data-testid="v2-cta-proxy"
      aria-label={t.ctaProxy}
    >
      <div className="v2-flow-card-head">
        <p className="v2-flow-label">{t.ctaProxy}</p>
        <p className="v2-flow-note">{t.ctaProxyNote}</p>
      </div>
      <strong
        className={`v2-flow-signal is-cta-${ctaProxy.signal ?? "unavailable"}`}
        data-testid="v2-cta-proxy-label"
      >
        {signalLabel}
      </strong>
      {ctaProxy.triggerLines.length > 0 ? (
        <ul className="v2-cta-triggers" data-testid="v2-cta-proxy-triggers">
          {ctaProxy.triggerLines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </article>
  );
}

function VolMispricingFlowCard({
  gamma,
  lang,
}: {
  gamma: readonly V2GammaSummary[];
  lang: V2Language;
}) {
  const t = copy[lang];
  const spy = gamma.find((item) => item.symbol === "SPY");
  const qqq = gamma.find((item) => item.symbol === "QQQ");
  const primary = spy?.volMispricing;
  const signalLabel = volMispricingSignalLabel(primary?.signal ?? null);

  return (
    <article className="v2-flow-card" data-testid="v2-vol-mispricing-flow">
      <div className="v2-flow-card-head">
        <p className="v2-flow-label">{t.volMispricing}</p>
        <p className="v2-flow-note">{t.volMispricingNote}</p>
      </div>
      <strong
        className={`v2-flow-signal ${volSignalClass(primary?.signal ?? null)}`}
        data-testid="v2-vol-flow-signal"
      >
        {signalLabel}
      </strong>
      {primary?.ivDataLabel ? (
        <p className="v2-flow-iv-label">{primary.ivDataLabel}</p>
      ) : null}
      <FlowSignalMetrics>
        <span>{t.iv}</span>
        <strong data-testid="v2-gamma-SPY-iv">
          {formatVolMispricingPct(primary?.ivPct ?? null)}
        </strong>
        <span>{t.hv20}</span>
        <strong data-testid="v2-gamma-SPY-hv20">
          {formatVolMispricingPct(primary?.hv20Pct ?? null)}
        </strong>
        <span>{t.ivMinusHv}</span>
        <strong data-testid="v2-gamma-SPY-iv-hv">
          {formatIvHvSpreadVolPts(primary?.spreadVolPts ?? null)}
        </strong>
      </FlowSignalMetrics>
      {qqq && qqq.volMispricing.status === "available" ? (
        <p className="v2-flow-subline">
          QQQ · {volMispricingSignalLabel(qqq.volMispricing.signal)} · IV{" "}
          {formatVolMispricingPct(qqq.volMispricing.ivPct)} · HV{" "}
          {formatVolMispricingPct(qqq.volMispricing.hv20Pct)}
        </p>
      ) : null}
    </article>
  );
}

function GammaInstrument({
  item,
  lang,
}: {
  item: V2GammaSummary;
  lang: V2Language;
}) {
  const t = copy[lang];
  const ready = item.status === "ready";
  const incomplete = item.status === "incomplete";
  const showStructure = ready || incomplete;
  const stale = item.freshness === "stale" || item.freshness === "incomplete";

  return (
    <article className="v2-gamma-instrument" data-testid={`v2-gamma-${item.symbol}`}>
      <div className="v2-instrument-head">
        <strong>{item.symbol}</strong>
        <span className="v2-instrument-meta" data-testid={`v2-gamma-${item.symbol}-meta`}>
          <span
            className="v2-data-label"
            data-testid={`v2-gamma-${item.symbol}-data-label`}
          >
            {item.dataLabel ?? item.sessionDate ?? "—"}
          </span>
          {stale ? <span className="v2-flow-badge is-stale">{t.stale}</span> : null}
        </span>
      </div>

      {showStructure ? (
        <>
          <StructureAxis item={item} lang={lang} />

          <div className="v2-structure-context">
            {item.dealerFlowRegime ? (
              <div
                className="v2-structure-context-item"
                data-testid={`v2-gamma-${item.symbol}-dealer-flow`}
              >
                <span>{t.dealerFlow}</span>
                <strong>{item.dealerFlowRegime}</strong>
              </div>
            ) : null}
            <div
              className="v2-structure-context-item"
              data-testid={`v2-gamma-${item.symbol}-rod-range`}
            >
              <span>{t.restOfDayRange}</span>
              <strong>{formatRestOfDayRangeLabel(item.restOfDayRange)}</strong>
            </div>
          </div>

          <div className="v2-structure-meta">
            <div className="v2-structure-context-item">
              <span>{t.netGex}</span>
              <strong data-testid={`v2-gamma-${item.symbol}-net-gex`}>
                {formatGexCompact(item.netGex)}
              </strong>
            </div>
          </div>
        </>
      ) : (
        <p className="v2-structure-empty">—</p>
      )}

      <details className="v2-details">
        <summary>{t.details}</summary>
        {item.contextLines.length > 0 ? (
          <ul className="v2-dealer-flow-context">
            {item.contextLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        <p>{item.quality}</p>
        <p>{item.isFixture ? "fixture" : item.source}</p>
        {item.expiration ? <p>{item.expiration}</p> : null}
      </details>

      <span
        className="v2-status-dot is-hidden"
        data-testid={`v2-gamma-${item.symbol}-badge`}
        hidden
      >
        {item.regime?.replaceAll("_", " ") ?? item.status}
      </span>
      <div
        className="v2-vol-mispricing is-hidden"
        data-testid={`v2-gamma-${item.symbol}-vol-mispricing`}
        hidden
      >
        <strong data-testid={`v2-gamma-${item.symbol}-vol-signal`}>
          {volMispricingSignalLabel(item.volMispricing.signal)}
        </strong>
      </div>
    </article>
  );
}

/** Maps risk 0–100 to needle rotation: 0=left, 50=top, 100=right. */
export function riskGaugeNeedleAngle(score: number): number {
  const safe = Math.max(0, Math.min(100, score));
  return -180 + safe * 1.8;
}

function RiskGauge({ score }: { score: number | null }) {
  const safe = score ?? 50;
  const angle = riskGaugeNeedleAngle(safe);
  return (
    <div
      className={`v2-gauge${score === null ? " is-disabled" : ""}`}
      aria-label={score === null ? "Risk unavailable" : `Risk ${score} of 100`}
    >
      <div className="v2-gauge-face">
        <span className="v2-gauge-needle" style={{ transform: `rotate(${angle}deg)` }} />
        <span className="v2-gauge-hub" />
      </div>
      <strong className="v2-gauge-score">{score ?? "—"}</strong>
    </div>
  );
}

function AllocationMap({
  view,
  lang,
}: {
  view: V2CommandCenterView;
  lang: V2Language;
}) {
  const t = copy[lang];
  const rows = [
    [t.highBeta, view.allocation?.highBeta ?? null, "high-beta"],
    [t.defense, view.allocation?.defense ?? null, "defense"],
    [t.metals, view.allocation?.metals ?? null, "metals"],
    [t.hedge, view.allocation?.hedge ?? null, "hedge"],
  ] as const;

  return (
    <div className="v2-allocation" aria-labelledby="allocation-heading">
      <div>
        <h3 id="allocation-heading">{t.allocation}</h3>
      </div>
      <div className="v2-allocation-bars">
        {rows.map(([label, value, tone]) => (
          <div className="v2-allocation-row" key={tone}>
            <span>{label}</span>
            <div className="v2-bar-track">
              <span className={`v2-bar-fill is-${tone}`} style={{ width: `${value ?? 0}%` }} />
            </div>
            <strong>{value === null ? "—" : `${value}%`}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function stancePresentation(
  stance: V2CommandCenterView["stance"],
  t: (typeof copy)[V2Language],
): { label: string; tone: "buy" | "hold" | "reduce" | "wait" } {
  switch (stance) {
    case "buy":
      return { label: t.stanceBuy, tone: "buy" };
    case "hold":
      return { label: t.stanceHold, tone: "hold" };
    case "reduce":
      return { label: t.stanceReduce, tone: "reduce" };
    default:
      return { label: t.awaiting, tone: "wait" };
  }
}

export function CommandCenter({
  view,
  lang,
  demoMode = false,
}: {
  view: V2CommandCenterView;
  lang: V2Language;
  demoMode?: boolean;
}) {
  const t = copy[lang];
  const preview = view.decisionStatus === "methodology_preview";
  const ready = view.decisionStatus === "ready";
  const stanceUi = stancePresentation(view.stance, t);
  const homePath = demoMode ? "/demo" : "/";
  const langQuery = `?lang=${lang}`;

  return (
    <div className="v2-app">
      <aside className="v2-sidebar">
        <a className="v2-mark" href={`${homePath}${langQuery}`} aria-label="GammaDesk home">G</a>
        <nav aria-label="V2 navigation">
          <a className="is-active" href="#overview"><span>01</span>{t.overview}</a>
          <a href="#gamma"><span>02</span>{t.structure}</a>
          <a href="#flow"><span>03</span>{t.flow}</a>
          <a href="#rotation"><span>04</span>{t.rotation}</a>
          <a href="#overview"><span>05</span>{t.study}</a>
          <a href="#overview"><span>06</span>{t.review}</a>
        </nav>
      </aside>

      <main className="v2-main">
        <header className="v2-topbar">
          <div>
            <strong>{t.product}</strong>
            <span>{t.subtitle}</span>
          </div>
          <div className="v2-top-actions">
            <span>{view.sessionDate ?? "—"}</span>
            <div className="v2-lang" aria-label="Language">
              <a className={lang === "zh" ? "is-active" : ""} href={`${homePath}?lang=zh`}>中文</a>
              <a className={lang === "en" ? "is-active" : ""} href={`${homePath}?lang=en`}>EN</a>
            </div>
          </div>
        </header>

        <div
          className={`v2-trust-banner ${preview ? "is-preview" : ready ? "is-ready" : "is-blocked"}`}
          data-testid={preview ? "banner-illustrative-demo" : undefined}
        >
          {preview ? t.preview : ready ? t.liveReady : t.liveBlocked}
        </div>

        <section className="v2-overview-section" id="overview" aria-label={t.overview}>
          <div className="v2-section-head">
            <p className="v2-eyebrow">01 / {t.overview.toUpperCase()}</p>
          </div>
          <div className="v2-overview-body">
            <div className="v2-decision">
              <article className="v2-panel v2-stance-panel">
                <p className="v2-eyebrow">{t.stance.toUpperCase()}</p>
                <div className="v2-stance-value">
                  <span className={`is-${stanceUi.tone}`} />
                  <h1>{stanceUi.label}</h1>
                </div>
                <div className="v2-macro-focus">
                  <span>{t.macroFocus}</span>
                  <strong>{view.macroLabel ?? t.noMacro}</strong>
                </div>
              </article>

              <article className="v2-panel v2-risk-panel">
                <p className="v2-eyebrow">{t.risk.toUpperCase()}</p>
                <div className="v2-risk-content">
                  <RiskGauge score={view.riskScore} />
                  <div className="v2-risk-stats">
                    <strong>
                      {view.riskChange === null
                        ? "—"
                        : `${view.riskChange > 0 ? "+" : ""}${view.riskChange}`}
                      <small>{t.vsYesterday}</small>
                    </strong>
                    <strong>
                      {view.opportunityScore ?? "—"}
                      <small>/ 100 {t.opportunity}</small>
                    </strong>
                  </div>
                </div>
                <div className="v2-exposure">
                  <span>{t.exposure}</span>
                  <strong>
                    {view.exposure ? `${view.exposure.min}–${view.exposure.max}%` : "—"}
                  </strong>
                </div>
              </article>
            </div>

            <AllocationMap view={view} lang={lang} />
          </div>
        </section>

        <section className="v2-structure-section" id="gamma" aria-label={t.structure}>
          <div className="v2-section-head">
            <p className="v2-eyebrow">02 / {t.structure.toUpperCase()}</p>
            <h2>{t.gamma}</h2>
          </div>
          <div className="v2-gamma-grid">
            {view.gamma.map((item) => <GammaInstrument key={item.symbol} item={item} lang={lang} />)}
          </div>
        </section>

        <section className="v2-flow-section" id="flow" aria-label={t.flow}>
          <p className="v2-eyebrow">03 / {t.flow.toUpperCase()}</p>
          <div className="v2-flow-grid">
            <BreadthFlowCard breadth={view.spyBreadth} lang={lang} />
            <CtaFlowCard ctaProxy={view.ctaProxy} lang={lang} />
            <VolMispricingFlowCard gamma={view.gamma} lang={lang} />
          </div>
        </section>

        <section
          className="v2-rotation-section"
          id="rotation"
          aria-label={t.rotation}
          data-testid="v2-rotation-placeholder"
        >
          <p className="v2-eyebrow">04 / {t.rotation.toUpperCase()}</p>
          <p className="v2-section-placeholder">—</p>
        </section>

        <section className="v2-evidence-grid">
          <article>
            <p className="v2-eyebrow">{t.why.toUpperCase()}</p>
            {view.evidence.length > 0 ? (
              <ol>{view.evidence.map((item) => <li key={item}>{item}</li>)}</ol>
            ) : <p>{t.liveBlocked}</p>}
          </article>
          <article>
            <p className="v2-eyebrow">{t.missing.toUpperCase()}</p>
            {view.missingInputs.length > 0 ? (
              <ul>{view.missingInputs.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : <p>{preview ? t.preview : t.liveBlocked}</p>}
          </article>
        </section>
      </main>
    </div>
  );
}
