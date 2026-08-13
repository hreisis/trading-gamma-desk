import type { ReactNode } from "react";
import type {
  V2AiStudyInterpretation,
  V2CommandCenterView,
  V2DailyReview,
  V2GammaSummary,
  V2Language,
  V2SectorRotationRow,
  V2SectorRotationSummary,
  V2SpyBreadthSummary,
} from "@/desk";
import type { V2CommandCenterPageView } from "@/desk/load-v2-home";
import { breadthSignalLabel, formatSectorEtfLabel, sectorRotationBarScale, sectorRotationBarWidthPct } from "@/desk/v2-command-center";
import {
  ctaProxySignalLabel,
  formatGexCompact,
  formatIvHvSpreadVolPts,
  formatRestOfDayRangeLabel,
  formatVolMispricingPct,
  remainingRegularSessionFraction,
  volMispricingSignalLabel,
  type RestOfDayRange,
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
    rotationLeading: "Leading / improving",
    rotationWeakening: "Weakening",
    rs1d: "1D RS",
    rs5d: "5D RS",
    study: "AI Study",
    studyNote: "AI interpretation of existing model outputs — not a separate signal engine.",
    studyConfidence: "Interpretation confidence",
    studyConfidenceHigh: "High",
    studyConfidenceModerate: "Moderate",
    studyConfidenceLimited: "Limited",
    dataLimitations: "Data limitations",
    regime: "Regime",
    baseCase: "Base case",
    ifThen: "If / then",
    invalidation: "Invalidation",
    tension: "Tension",
    deterministicFallback: "Deterministic fallback",
    review: "Daily Review",
    reviewNote: "End-of-day comparison of the published command center snapshot vs session outcomes.",
    reviewSession: "Session",
    morningStance: "Morning stance",
    actualOutcome: "Actual outcome",
    whatWorked: "What worked",
    whatFailed: "What failed",
    errorSource: "Error source",
    tomorrowWatch: "Tomorrow watch",
    reviewConfidence: "Critique confidence",
    reviewPending: "Pending",
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
    axisPut: "Put",
    axisCall: "Call",
    axisFlip: "Flip",
    putWall: "Put wall",
    callWall: "Call wall",
    restOfDayRange: "ROD 90%",
    marketClosed: "Market closed",
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
    rotationLeading: "领先 / 改善",
    rotationWeakening: "走弱",
    rs1d: "1日相对强度",
    rs5d: "5日相对强度",
    study: "AI 研究",
    studyNote: "对现有模型输出的 AI 解读 · 非独立信号引擎。",
    studyConfidence: "解读置信度",
    studyConfidenceHigh: "高",
    studyConfidenceModerate: "中",
    studyConfidenceLimited: "低",
    dataLimitations: "数据限制",
    regime: "市场状态",
    baseCase: "基准情景",
    ifThen: "条件路径",
    invalidation: "失效条件",
    tension: "信号分歧",
    deterministicFallback: "确定性回退摘要",
    review: "每日复盘",
    reviewNote: "对已发布指挥中心快照与当日结果的对照复盘。",
    reviewSession: "交易日",
    morningStance: "早盘立场",
    actualOutcome: "实际结果",
    whatWorked: "有效部分",
    whatFailed: "失效部分",
    errorSource: "误差来源",
    tomorrowWatch: "明日关注",
    reviewConfidence: "复盘置信度",
    reviewPending: "待生成",
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
    axisPut: "Put",
    axisCall: "Call",
    axisFlip: "Flip",
    putWall: "Put Wall",
    callWall: "Call Wall",
    restOfDayRange: "日内 90%",
    marketClosed: "市场已收盘",
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

function formatRiskChangeLine(
  change: number | null,
  vsYesterday: string,
): string {
  if (change === null) return "—";
  if (change === 0) return "0";
  const arrow = change > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(change)} ${vsYesterday}`;
}

function wallTouchPercentLabel(
  touch: V2GammaSummary["callWallTouch"],
): string | null {
  if (touch.status !== "available" || touch.percent === null) {
    return null;
  }
  return `${touch.percent}%`;
}

export function isRegularSessionClosed(now: Date): boolean {
  return remainingRegularSessionFraction(now) === 0;
}

export function formatStructureRodDisplayLabel(
  range: RestOfDayRange,
  lang: V2Language,
  now: Date = new Date(),
): string {
  if (range.status === "available") {
    return formatRestOfDayRangeLabel(range);
  }
  if (isRegularSessionClosed(now)) {
    return copy[lang].marketClosed;
  }
  return formatRestOfDayRangeLabel(range);
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

export function formatStructureAxisLevelRow(
  item: V2GammaSummary,
  labels: { put: string; flip: string; call: string },
): string {
  const put =
    item.putWall !== null ? `${labels.put} ${formatLevel(item.putWall)}` : "—";
  const flip =
    item.gammaFlip !== null
      ? `${labels.flip} ${formatLevel(item.gammaFlip)}`
      : "—";
  const call =
    item.callWall !== null ? `${labels.call} ${formatLevel(item.callWall)}` : "—";
  return `${put}   |   ${flip}   |   ${call}`;
}

function StructureAxisTick({
  leftPct,
  tone,
}: {
  leftPct: number;
  tone: "put" | "call" | "flip";
}) {
  return (
    <div
      className={`v2-structure-axis-tick-marker is-${tone}`}
      style={{ left: `${leftPct}%` }}
    />
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
  const now = new Date();
  const sessionClosed =
    item.restOfDayRange.status !== "available" && isRegularSessionClosed(now);

  const rod =
    item.restOfDayRange.status === "available" &&
    item.restOfDayRange.lower !== null &&
    item.restOfDayRange.upper !== null
      ? {
          left: pct(item.restOfDayRange.lower),
          width: pct(item.restOfDayRange.upper) - pct(item.restOfDayRange.lower),
        }
      : null;

  const putLabel =
    item.putWall !== null ? `${t.axisPut.toUpperCase()} ${formatLevel(item.putWall)}` : "—";
  const flipLabel =
    item.gammaFlip !== null
      ? `${t.axisFlip.toUpperCase()} ${formatLevel(item.gammaFlip)}`
      : "—";
  const callLabel =
    item.callWall !== null ? `${t.axisCall.toUpperCase()} ${formatLevel(item.callWall)}` : "—";

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
              style={{
                left: `${rod.left}%`,
                width: `${Math.max(rod.width, 0.4)}%`,
              }}
              data-testid={`v2-gamma-${item.symbol}-rod-band`}
            />
          ) : sessionClosed ? (
            <div
              className="v2-structure-axis-rod is-closed"
              data-testid={`v2-gamma-${item.symbol}-rod-band`}
              aria-hidden="true"
            />
          ) : null}
          {item.putWall !== null ? (
            <StructureAxisTick leftPct={pct(item.putWall)} tone="put" />
          ) : null}
          {item.gammaFlip !== null ? (
            <StructureAxisTick leftPct={pct(item.gammaFlip)} tone="flip" />
          ) : null}
          {item.callWall !== null ? (
            <StructureAxisTick leftPct={pct(item.callWall)} tone="call" />
          ) : null}
        </div>
        {item.spot !== null ? (
          <div
            className="v2-structure-axis-spot"
            style={{ left: `${pct(item.spot)}%` }}
          >
            <span className="v2-structure-axis-marker-label">{t.spot}</span>
            <strong className="v2-structure-axis-marker-value">
              {formatLevel(item.spot)}
            </strong>
            <span className="v2-structure-axis-tick is-spot" />
          </div>
        ) : null}
      </div>
      <div
        className="v2-structure-axis-label-row"
        data-testid={`v2-gamma-${item.symbol}-structure-labels`}
      >
        <span
          className="v2-structure-axis-label-cell is-put"
          data-testid={`v2-gamma-${item.symbol}-put-touch`}
        >
          {putLabel}
          {wallTouchPercentLabel(item.putWallTouch)
            ? ` · ${wallTouchPercentLabel(item.putWallTouch)}`
            : null}
        </span>
        <span className="v2-structure-axis-label-divider">|</span>
        <span
          className="v2-structure-axis-label-cell is-flip"
          data-testid={`v2-gamma-${item.symbol}-flip`}
        >
          {flipLabel}
        </span>
        <span className="v2-structure-axis-label-divider">|</span>
        <span
          className="v2-structure-axis-label-cell is-call"
          data-testid={`v2-gamma-${item.symbol}-call-touch`}
        >
          {callLabel}
          {wallTouchPercentLabel(item.callWallTouch)
            ? ` · ${wallTouchPercentLabel(item.callWallTouch)}`
            : null}
        </span>
      </div>
    </div>
  );
}

function formatRelativeStrengthPct(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function SectorRotationBarRow({
  row,
  scale,
  rs1dLabel,
  rs5dLabel,
  showDivider,
}: {
  row: V2SectorRotationRow;
  scale: number;
  rs1dLabel: string;
  rs5dLabel: string;
  showDivider: boolean;
}) {
  const widthPct = sectorRotationBarWidthPct(row.rs5d, scale);
  const positive = row.rs5d >= 0;

  return (
    <>
      {showDivider ? <div className="v2-rotation-bar-divider" aria-hidden="true" /> : null}
      <div
        className={`v2-rotation-bar-row is-${row.classification}`}
        data-testid={`v2-sector-rotation-row-${row.symbol}`}
      >
        <div className="v2-rotation-bar-label">{formatSectorEtfLabel(row.symbol)}</div>
        <div className="v2-rotation-bar-track" aria-hidden="true">
          <div className="v2-rotation-bar-zero" />
          <div
            className={`v2-rotation-bar-fill is-${positive ? "pos" : "neg"}`}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <div className="v2-rotation-bar-values">
          <strong title={rs5dLabel}>{formatRelativeStrengthPct(row.rs5d)}</strong>
          <span title={rs1dLabel}>{formatRelativeStrengthPct(row.rs1d)}</span>
        </div>
      </div>
    </>
  );
}

function SectorRotationSection({
  rotation,
  lang,
}: {
  rotation: V2SectorRotationSummary;
  lang: V2Language;
}) {
  const t = copy[lang];
  const ready = rotation.status === "available";

  return (
    <section
      className="v2-rotation-section"
      id="rotation"
      aria-label={t.rotation}
      data-testid="v2-sector-rotation"
    >
      <div className="v2-section-head v2-rotation-head">
        <p className="v2-eyebrow">04 / {t.rotation.toUpperCase()}</p>
        <div className="v2-rotation-meta" data-testid="v2-sector-rotation-meta">
          <span>{t.session}</span>
          <strong data-testid="v2-sector-rotation-session">
            {rotation.sessionDate ?? "—"}
          </strong>
          {rotation.stale ? (
            <span className="v2-flow-badge is-stale" data-testid="v2-sector-rotation-stale">
              {t.stale}
            </span>
          ) : null}
        </div>
      </div>
      {ready ? (
        <>
          <div className="v2-rotation-summary" data-testid="v2-sector-rotation-summary">
            <p className="v2-rotation-summary-line" data-testid="v2-sector-rotation-leading">
              <span className="v2-rotation-summary-label">{t.rotationLeading}</span>
              {rotation.topLeadingImproving.length > 0
                ? rotation.topLeadingImproving
                    .map((row) => formatSectorEtfLabel(row.symbol))
                    .join(" · ")
                : "—"}
            </p>
            <p className="v2-rotation-summary-line" data-testid="v2-sector-rotation-weakening">
              <span className="v2-rotation-summary-label">{t.rotationWeakening}</span>
              {rotation.bottomWeakening.length > 0
                ? rotation.bottomWeakening
                    .map((row) => formatSectorEtfLabel(row.symbol))
                    .join(" · ")
                : "—"}
            </p>
          </div>
          <div className="v2-rotation-chart" data-testid="v2-sector-rotation-chart">
            <div className="v2-rotation-chart-head">
              <span>{t.rs5d} vs SPY</span>
              <span className="v2-rotation-chart-axis" aria-hidden="true">
                <span>−</span>
                <span>SPY</span>
                <span>+</span>
              </span>
            </div>
            {(() => {
              const sorted = [...rotation.sectors].sort(
                (left, right) => right.rs5d - left.rs5d,
              );
              const scale = sectorRotationBarScale(sorted);
              let sawPositive = false;
              return sorted.map((row) => {
                const showDivider =
                  sawPositive && row.rs5d < 0 && sorted.some((item) => item.rs5d > 0);
                if (row.rs5d > 0) sawPositive = true;
                return (
                  <SectorRotationBarRow
                    key={row.symbol}
                    row={row}
                    scale={scale}
                    rs1dLabel={t.rs1d}
                    rs5dLabel={t.rs5d}
                    showDivider={showDivider}
                  />
                );
              });
            })()}
          </div>
        </>
      ) : (
        <p className="v2-rotation-missing" data-testid="v2-sector-rotation-reason">
          {rotation.missingReason ?? "—"}
        </p>
      )}
    </section>
  );
}

function DailyReviewSection({
  review,
  lang,
}: {
  review: V2DailyReview;
  lang: V2Language;
}) {
  const t = copy[lang];

  return (
    <section
      className="v2-daily-review-section"
      id="daily-review"
      aria-label={t.review}
      data-testid="v2-daily-review"
    >
      <div className="v2-section-head v2-daily-review-head">
        <div>
          <p className="v2-eyebrow">06 / {t.review.toUpperCase()}</p>
          <p className="v2-daily-review-note">{t.reviewNote}</p>
        </div>
        <div className="v2-daily-review-meta" data-testid="v2-daily-review-meta">
          {review.status === "ready" ? (
            <>
              <span>{t.reviewConfidence}</span>
              <strong
                className={`v2-daily-review-confidence is-${review.confidence}`}
                data-testid="v2-daily-review-confidence"
              >
                {aiStudyConfidenceLabel(review.confidence, lang)}
              </strong>
              {review.source === "deterministic" ? (
                <span
                  className="v2-flow-badge is-stale"
                  data-testid="v2-daily-review-fallback"
                >
                  {t.deterministicFallback}
                </span>
              ) : null}
            </>
          ) : null}
          {review.status === "pending" ? (
            <span className="v2-flow-badge is-stale" data-testid="v2-daily-review-pending">
              {t.reviewPending}
            </span>
          ) : null}
        </div>
      </div>
      <article className="v2-daily-review-card" data-testid="v2-daily-review-card">
        {review.dataLimitations.length > 0 ? (
          <p className="v2-daily-review-limitations" data-testid="v2-daily-review-limitations">
            <span className="v2-daily-review-limitations-label">{t.dataLimitations}</span>
            {review.dataLimitations.join(" · ")}
          </p>
        ) : null}
        {review.sessionDate ? (
          <p className="v2-daily-review-session" data-testid="v2-daily-review-session">
            {t.reviewSession}: <strong>{review.sessionDate}</strong>
          </p>
        ) : null}
        <dl className="v2-daily-review-list">
          <div>
            <dt>{t.morningStance}</dt>
            <dd data-testid="v2-daily-review-morning">
              {review.morningStance ?? "—"}
            </dd>
          </div>
          <div>
            <dt>{t.actualOutcome}</dt>
            <dd data-testid="v2-daily-review-outcome">{review.actualOutcome}</dd>
          </div>
          <div>
            <dt>{t.whatWorked}</dt>
            <dd data-testid="v2-daily-review-worked">
              {review.whatWorked.length > 0 ? (
                <ul>
                  {review.whatWorked.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>{t.whatFailed}</dt>
            <dd data-testid="v2-daily-review-failed">
              {review.whatFailed.length > 0 ? (
                <ul>
                  {review.whatFailed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {review.errorSource !== "none" || review.errorExplanation ? (
            <div>
              <dt>{t.errorSource}</dt>
              <dd data-testid="v2-daily-review-error-source">
                <strong>{review.errorSource}</strong>
                {review.errorExplanation ? ` — ${review.errorExplanation}` : null}
              </dd>
            </div>
          ) : review.errorExplanation ? (
            <div>
              <dt>{t.errorSource}</dt>
              <dd data-testid="v2-daily-review-error-source">
                none — {review.errorExplanation}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t.tomorrowWatch}</dt>
            <dd data-testid="v2-daily-review-watch">
              {review.tomorrowWatch.length > 0 ? (
                <ul>
                  {review.tomorrowWatch.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {review.missingReason ? (
          <p className="v2-daily-review-missing" data-testid="v2-daily-review-reason">
            {review.missingReason}
          </p>
        ) : null}
      </article>
    </section>
  );
}

function aiStudyConfidenceLabel(
  confidence: V2AiStudyInterpretation["confidence"],
  lang: V2Language,
): string {
  const t = copy[lang];
  switch (confidence) {
    case "high":
      return t.studyConfidenceHigh;
    case "moderate":
      return t.studyConfidenceModerate;
    case "limited":
      return t.studyConfidenceLimited;
  }
}

function AiStudySection({
  aiStudy,
  lang,
}: {
  aiStudy: V2AiStudyInterpretation;
  lang: V2Language;
}) {
  const t = copy[lang];

  return (
    <section
      className="v2-ai-study-section"
      id="ai-study"
      aria-label={t.study}
      data-testid="v2-ai-study"
    >
      <div className="v2-section-head v2-ai-study-head">
        <div>
          <p className="v2-eyebrow">05 / {t.study.toUpperCase()}</p>
          <p className="v2-ai-study-note">{t.studyNote}</p>
        </div>
        <div className="v2-ai-study-meta" data-testid="v2-ai-study-meta">
          <span>{t.studyConfidence}</span>
          <strong
            className={`v2-ai-study-confidence is-${aiStudy.confidence}`}
            data-testid="v2-ai-study-confidence"
          >
            {aiStudyConfidenceLabel(aiStudy.confidence, lang)}
          </strong>
          {aiStudy.source === "deterministic" || aiStudy.status === "fallback" ? (
            <span className="v2-flow-badge is-stale" data-testid="v2-ai-study-fallback">
              {t.deterministicFallback}
            </span>
          ) : null}
        </div>
      </div>
      <article className="v2-ai-study-card" data-testid="v2-ai-study-card">
        {aiStudy.dataLimitations.length > 0 ? (
          <p className="v2-ai-study-limitations" data-testid="v2-ai-study-limitations">
            <span className="v2-ai-study-limitations-label">{t.dataLimitations}</span>
            {aiStudy.dataLimitations.join(" · ")}
          </p>
        ) : null}
        <dl className="v2-ai-study-list">
          <div>
            <dt>{t.regime}</dt>
            <dd data-testid="v2-ai-study-regime">{aiStudy.regime}</dd>
          </div>
          <div>
            <dt>{t.baseCase}</dt>
            <dd data-testid="v2-ai-study-base-case">{aiStudy.baseCase}</dd>
          </div>
          <div>
            <dt>{t.ifThen}</dt>
            <dd data-testid="v2-ai-study-if-then">{aiStudy.ifThen}</dd>
          </div>
          <div>
            <dt>{t.invalidation}</dt>
            <dd data-testid="v2-ai-study-invalidation">{aiStudy.invalidation}</dd>
          </div>
          <div>
            <dt>{t.tension}</dt>
            <dd data-testid="v2-ai-study-tension">{aiStudy.tension}</dd>
          </div>
        </dl>
        {aiStudy.missingReason ? (
          <p className="v2-ai-study-missing" data-testid="v2-ai-study-reason">
            {aiStudy.missingReason}
          </p>
        ) : null}
      </article>
    </section>
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
              <strong>{formatStructureRodDisplayLabel(item.restOfDayRange, lang)}</strong>
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
  view: V2CommandCenterPageView;
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
          <a href="#ai-study"><span>05</span>{t.study}</a>
          <a href="#daily-review"><span>06</span>{t.review}</a>
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
                  <strong>
                    {view.macroSummary?.label ?? view.macroLabel ?? t.noMacro}
                  </strong>
                  {view.macroSummary?.interpretation ? (
                    <p
                      className="v2-macro-interpretation"
                      data-testid="v2-macro-interpretation"
                    >
                      {view.macroSummary.interpretation}
                    </p>
                  ) : null}
                  {view.macroSummary &&
                  view.macroSummary.evidence.length > 0 &&
                  !view.macroSummary.interpretation ? (
                    <ul
                      className="v2-macro-evidence"
                      data-testid="v2-macro-evidence"
                    >
                      {view.macroSummary.evidence.slice(0, 2).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>

              <article className="v2-panel v2-risk-panel">
                <p className="v2-eyebrow">{t.risk.toUpperCase()}</p>
                <div className="v2-risk-content">
                  <RiskGauge score={view.riskScore} />
                  <div className="v2-risk-stats">
                    <div className="v2-risk-delta">
                      <strong
                        className="v2-risk-change"
                        data-testid="v2-risk-change"
                      >
                        {formatRiskChangeLine(view.riskChange, t.vsYesterday)}
                      </strong>
                      {view.riskChangeReason ? (
                        <p
                          className="v2-risk-change-reason"
                          data-testid="v2-risk-change-reason"
                        >
                          {view.riskChangeReason}
                        </p>
                      ) : null}
                    </div>
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

        <SectorRotationSection rotation={view.sectorRotation} lang={lang} />

        <AiStudySection aiStudy={view.aiStudy} lang={lang} />

        <DailyReviewSection review={view.dailyReview} lang={lang} />

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
