import type {
  V2CommandCenterView,
  V2GammaSummary,
  V2Language,
  V2SpyBreadthSummary,
} from "@/desk";

const copy = {
  en: {
    product: "GammaDesk",
    subtitle: "Daily Market Decision Copilot",
    overview: "Overview",
    structure: "Market Structure",
    macro: "Macro Focus",
    rotation: "Rotation",
    study: "AI Study",
    review: "Daily Review",
    preview: "Illustrative methodology preview · synthetic decision values",
    liveBlocked: "Live decision withheld · required inputs are not connected",
    stance: "Daily stance",
    selectiveBuy: "Selective buy",
    awaiting: "Awaiting inputs",
    stanceNote: "Add risk selectively; do not chase broad leverage.",
    risk: "Portfolio risk",
    riskScale: "0 lowest risk · 100 highest risk",
    vsYesterday: "vs yesterday",
    opportunity: "Dip opportunity",
    exposure: "Recommended exposure",
    exposureScale: "0–150% gross exposure",
    gamma: "SPY / QQQ gamma",
    gammaNote: "Structure context, not a directional forecast",
    breadth: "SPY breadth internals",
    breadthNote: "Official SPY holdings universe · durable daily snapshot",
    session: "Session",
    asOf: "As-of",
    advance: "Advance",
    decline: "Decline",
    unchanged: "Unchanged",
    aboveMa20: "> MA20",
    aboveMa50: "> MA50",
    new20dHighs: "20D closing highs",
    new20dLows: "20D closing lows",
    stale: "Stale",
    spot: "Spot",
    putWall: "Put wall",
    callWall: "Call wall",
    corridor: "Wall corridor",
    likelyPin: "Likely pin",
    awaitingModel: "Awaiting tested model",
    unavailable: "Unavailable",
    allocation: "Risk allocation map",
    allocationNote: "Share of deployed capital · separate from total exposure",
    highBeta: "High beta",
    defense: "Defense",
    metals: "Metals",
    hedge: "Hedge",
    why: "Why this view",
    missing: "Required before live output",
    macroFocus: "Macro focus",
    noMacro: "No aligned macro snapshot",
    gammaFlip: "Gamma Flip unavailable — no true zero-crossing model",
    bounded: "Bounded",
    details: "Data quality & source",
  },
  zh: {
    product: "GammaDesk",
    subtitle: "每日市场决策 Copilot",
    overview: "总览",
    structure: "市场结构",
    macro: "宏观重点",
    rotation: "板块轮动",
    study: "AI 研究",
    review: "每日复盘",
    preview: "方法论预览 · 决策数值为明确标注的模拟数据",
    liveBlocked: "实时决策暂不输出 · 必要输入尚未接通",
    stance: "今日操作",
    selectiveBuy: "选择性加仓",
    awaiting: "等待数据",
    stanceNote: "可以选择性增加风险，但不建议全面追涨或加杠杆。",
    risk: "组合风险",
    riskScale: "0 风险最低 · 100 风险最高",
    vsYesterday: "较昨日",
    opportunity: "回调机会",
    exposure: "建议总仓位",
    exposureScale: "0–150% 总敞口",
    gamma: "SPY / QQQ Gamma",
    gammaNote: "描述市场结构，不是方向预测",
    breadth: "SPY 广度内部指标",
    breadthNote: "官方 SPY 持仓 universe · 持久化每日快照",
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
    corridor: "双墙区间",
    likelyPin: "最可能收盘区域",
    awaitingModel: "等待经过验证的模型",
    unavailable: "不可用",
    allocation: "风险配置地图",
    allocationNote: "已投入资金的内部比例 · 与总仓位分开",
    highBeta: "高 Beta",
    defense: "防御",
    metals: "金属",
    hedge: "对冲",
    why: "判断依据",
    missing: "实时输出前仍需接入",
    macroFocus: "今日宏观重点",
    noMacro: "没有时间对齐的宏观快照",
    gammaFlip: "Gamma Flip 暂不可用——尚无真实零交叉模型",
    bounded: "有限范围",
    details: "数据质量与来源",
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

function SpyBreadthPanel({
  breadth,
  lang,
}: {
  breadth: V2SpyBreadthSummary;
  lang: V2Language;
}) {
  const t = copy[lang];
  const ready = breadth.status === "available" || breadth.status === "partial";

  return (
    <section
      className="v2-breadth-panel"
      id="breadth"
      data-testid="v2-spy-breadth"
      aria-labelledby="breadth-heading"
    >
      <div className="v2-breadth-head">
        <div>
          <p className="v2-eyebrow">05 / BREADTH</p>
          <h2 id="breadth-heading">{t.breadth}</h2>
          <p className="v2-panel-note">{t.breadthNote}</p>
        </div>
        <div className="v2-breadth-badges">
          <span
            className={`v2-breadth-status is-${breadth.status}`}
            data-testid="v2-spy-breadth-status"
          >
            {breadth.status}
          </span>
          {breadth.stale ? (
            <span className="v2-breadth-stale" data-testid="v2-spy-breadth-stale">
              {t.stale}
            </span>
          ) : null}
        </div>
      </div>

      {ready ? (
        <>
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
              <strong data-testid="v2-spy-breadth-advance">
                {breadth.advance ?? "—"}
              </strong>
            </div>
            <div>
              <span>{t.decline}</span>
              <strong data-testid="v2-spy-breadth-decline">
                {breadth.decline ?? "—"}
              </strong>
            </div>
            <div>
              <span>{t.unchanged}</span>
              <strong>{breadth.unchanged ?? "—"}</strong>
            </div>
            <div>
              <span>{t.aboveMa20}</span>
              <strong data-testid="v2-spy-breadth-ma20">
                {formatMetric(breadth.percentAboveMA20)}
              </strong>
            </div>
            <div>
              <span>{t.aboveMa50}</span>
              <strong data-testid="v2-spy-breadth-ma50">
                {formatMetric(breadth.percentAboveMA50)}
              </strong>
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
        </>
      ) : (
        <p className="v2-breadth-missing" data-testid="v2-spy-breadth-reason">
          {breadth.missingReason ?? t.unavailable}
        </p>
      )}

      {breadth.sourceArtifact ? (
        <p className="v2-breadth-source">{breadth.sourceArtifact}</p>
      ) : null}
    </section>
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
  const corridor =
    item.putWall !== null && item.callWall !== null
      ? `${formatLevel(Math.min(item.putWall, item.callWall))}–${formatLevel(Math.max(item.putWall, item.callWall))}`
      : "—";

  return (
    <article className="v2-gamma-instrument" data-testid={`v2-gamma-${item.symbol}`}>
      <div className="v2-instrument-head">
        <strong>{item.symbol}</strong>
        <span className={`v2-status-dot ${item.status === "ready" ? "is-ready" : ""}`}>
          {item.status === "ready" ? item.regime?.replaceAll("_", " ") : t.unavailable}
        </span>
      </div>
      <div className="v2-level-grid">
        <span>{t.putWall}</span>
        <span>{t.spot}</span>
        <span>{t.callWall}</span>
        <strong>{formatLevel(item.putWall)}</strong>
        <strong>{formatLevel(item.spot)}</strong>
        <strong>{formatLevel(item.callWall)}</strong>
      </div>
      <div className="v2-corridor-row">
        <span>{t.corridor}</span>
        <strong>{corridor}</strong>
      </div>
      <div className="v2-corridor-row is-muted">
        <span>{t.likelyPin}</span>
        <strong>{t.awaitingModel}</strong>
      </div>
      <details className="v2-details">
        <summary>{t.details}</summary>
        <p>{item.quality}</p>
        <p>{item.isFixture ? "fixture" : item.source}</p>
      </details>
    </article>
  );
}

function RiskGauge({ score }: { score: number | null }) {
  const safe = score ?? 50;
  const angle = -90 + safe * 1.8;
  return (
    <div className={`v2-gauge${score === null ? " is-disabled" : ""}`} aria-label={score === null ? "Risk unavailable" : `Risk ${score} of 100`}>
      <div className="v2-gauge-face">
        <span className="v2-gauge-needle" style={{ transform: `rotate(${angle}deg)` }} />
        <span className="v2-gauge-hub" />
      </div>
      <strong>{score ?? "—"}</strong>
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
    <section className="v2-allocation" aria-labelledby="allocation-heading">
      <div>
        <p className="v2-eyebrow">04 / ALLOCATION</p>
        <h2 id="allocation-heading">{t.allocation}</h2>
        <p>{t.allocationNote}</p>
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
    </section>
  );
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
  const homePath = demoMode ? "/demo" : "/";
  const langQuery = `?lang=${lang}`;

  return (
    <div className="v2-app">
      <aside className="v2-sidebar">
        <a className="v2-mark" href={`${homePath}${langQuery}`} aria-label="GammaDesk home">G</a>
        <nav aria-label="V2 navigation">
          <a className="is-active" href="#overview"><span>01</span>{t.overview}</a>
          <a href="#gamma"><span>02</span>{t.structure}</a>
          <a href="#overview"><span>03</span>{t.macro}</a>
          <a href="#allocation-heading"><span>04</span>{t.rotation}</a>
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
          className={`v2-trust-banner ${preview ? "is-preview" : "is-blocked"}`}
          data-testid={preview ? "banner-illustrative-demo" : undefined}
        >
          {preview ? t.preview : t.liveBlocked}
        </div>

        <section className="v2-command" id="overview" aria-label="Daily command center">
          <article className="v2-panel v2-stance-panel">
            <p className="v2-eyebrow">01 / {t.stance.toUpperCase()}</p>
            <div className="v2-stance-value">
              <span className={view.stance ? "is-buy" : "is-wait"} />
              <h1>{view.stance ? t.selectiveBuy : t.awaiting}</h1>
            </div>
            <p>{view.stance ? t.stanceNote : t.liveBlocked}</p>
            <div className="v2-macro-focus">
              <span>{t.macroFocus}</span>
              <strong>{view.macroLabel ?? t.noMacro}</strong>
            </div>
          </article>

          <article className="v2-panel v2-risk-panel">
            <p className="v2-eyebrow">02 / {t.risk.toUpperCase()}</p>
            <div className="v2-risk-content">
              <RiskGauge score={view.riskScore} />
              <div className="v2-risk-stats">
                <span>{t.riskScale}</span>
                <strong>{view.riskChange === null ? "—" : `${view.riskChange > 0 ? "+" : ""}${view.riskChange}`} <small>{t.vsYesterday}</small></strong>
                <span>{t.opportunity}</span>
                <strong>{view.opportunityScore ?? "—"}<small>/ 100</small></strong>
              </div>
            </div>
            <div className="v2-exposure">
              <span>{t.exposure}</span>
              <strong>{view.exposure ? `${view.exposure.min}–${view.exposure.max}%` : "—"}</strong>
              <small>{t.exposureScale}</small>
            </div>
          </article>

          <article className="v2-panel v2-gamma-panel" id="gamma">
            <p className="v2-eyebrow">03 / {t.gamma.toUpperCase()}</p>
            <h2>{t.gamma}</h2>
            <p className="v2-panel-note">{t.gammaNote}</p>
            <div className="v2-gamma-grid">
              {view.gamma.map((item) => <GammaInstrument key={item.symbol} item={item} lang={lang} />)}
            </div>
            <p className="v2-flip-warning">{t.gammaFlip}</p>
          </article>
        </section>

        <SpyBreadthPanel breadth={view.spyBreadth} lang={lang} />

        <AllocationMap view={view} lang={lang} />

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
