import { summarizeV2AiStudyInputCoverage } from "@/ai-study/v2-command-interpret";
import { resolveAiStudyMarketStatus } from "@/ai-study/session";
import type { V2CommandCenterPageView } from "@/desk/load-v2-home";
import type { V2Language } from "@/desk";
import type { V2AiStudyConfidence } from "@/desk/v2-command-center";

const BLUE = "#004fff";
const GOOD = "#0a963f";
const BAD = "#ff2e2e";

const SECTOR_NAMES: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLI: "Industrials",
  XLV: "Health Care",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLU: "Utilities",
  XLB: "Materials",
  XLRE: "Real Estate",
  XLC: "Communication",
};

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function signed(n: number | null | undefined, suffix = "", digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmt(n, digits)}${suffix}`;
}

function formatRiskDivergenceValue(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
}

function riskLabel(score: number | null, lang: V2Language = "en") {
  if (score == null) return lang === "zh" ? "不可用" : "Unavailable";
  if (score <= 40) return lang === "zh" ? "低 / 支撑" : "Low / Supportive";
  if (score <= 65) return lang === "zh" ? "中性 / 中等" : "Neutral / Moderate";
  return lang === "zh" ? "偏高 / 防御" : "Elevated / Defensive";
}

function stanceLabel(stance: V2CommandCenterPageView["stance"], lang: V2Language) {
  if (lang === "zh") {
    if (stance === "buy") return "买入";
    if (stance === "reduce") return "减仓";
    return "持有";
  }
  return (stance ?? "hold").toUpperCase();
}

function stanceSummary(view: V2CommandCenterPageView, lang: V2Language) {
  const direction = view.macroSummary?.riskDirection ?? null;
  if (lang === "zh") {
    const macro =
      direction === "risk_on"
        ? "宏观环境偏风险偏好"
        : direction === "risk_off"
          ? "宏观环境偏防御"
          : direction === "mixed"
            ? "宏观信号分化"
            : "宏观信号中性";
    return `${macro}；当前${stanceLabel(view.stance, "zh")}，结构性风险${riskLabel(view.riskScore, "zh")}。`;
  }
  const macro = view.macroSummary?.label ?? view.macroLabel ?? "Mixed macro conditions";
  return `${macro}; ${stanceLabel(view.stance, "en")} with ${riskLabel(view.riskScore, "en").toLowerCase()} structural risk.`;
}

function highBetaAction(view: V2CommandCenterPageView) {
  if (view.allocation?.highBeta == null) return "—";
  if (view.riskChange == null || Math.abs(view.riskChange) <= 2) return "HOLD";
  return view.riskChange > 0 ? "TRIM" : "ADD";
}

function confidencePct(level: V2CommandCenterPageView["aiStudy"]["confidence"]) {
  if (level === "high") return 82;
  if (level === "moderate") return 58;
  return 35;
}

function aiStudyConfidenceLabel(level: V2AiStudyConfidence, lang: V2Language) {
  if (lang === "zh") {
    if (level === "high") return "高";
    if (level === "moderate") return "中等";
    return "有限";
  }
  if (level === "high") return "High";
  if (level === "moderate") return "Moderate";
  return "Limited";
}

function coneFor(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  return view.gammaCone.find((item) => item.symbol === symbol);
}

function gammaFor(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  return view.gamma.find((item) => item.symbol === symbol);
}

function bandText(band: { lower: number; upper: number } | null | undefined) {
  if (!band) return "—";
  return `${fmt(band.lower, band.lower >= 100 ? 0 : 1)}–${fmt(
    band.upper,
    band.upper >= 100 ? 0 : 1,
  )}`;
}

function levelPct(value: number | null, values: number[]) {
  if (value == null || values.length === 0) return 50;
  const min0 = Math.min(...values);
  const max0 = Math.max(...values);
  const span0 = Math.max(1, max0 - min0);
  const min = min0 - span0 * 0.08;
  const max = max0 + span0 * 0.08;
  return ((value - min) / (max - min)) * 100;
}

function distanceFromSpotPct(level: number | null, spot: number | null) {
  if (level == null || spot == null || spot <= 0) return null;
  return ((level / spot) - 1) * 100;
}

function quoteFor(view: V2CommandCenterPageView, symbol: string) {
  return view.marketQuotes.find((quote) => quote.symbol === symbol);
}

function Ticker({ view, symbol }: { view: V2CommandCenterPageView; symbol: string }) {
  const quote = quoteFor(view, symbol);
  const change = quote?.dailyChangePct ?? null;
  if (quote?.latestPrice == null) return null;
  return (
    <span className="pv-ticker">
      <b>{symbol}</b>
      <strong>{fmt(quote.latestPrice, 2)}</strong>
      <em className={change == null ? "" : change >= 0 ? "good" : "bad"}>
        {change == null ? "" : signed(change, "%", 2)}
      </em>
    </span>
  );
}

function eventKindLabel(kind: string) {
  if (kind === "cpi") return "CPI";
  if (kind === "payrolls") return "NFP";
  if (kind.startsWith("fomc")) return "FOMC";
  return kind.toUpperCase();
}

function formatEventTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function scheduledEventLine(view: V2CommandCenterPageView) {
  const gate = view.eventGate;
  if (!gate || gate.state === "clear" || gate.state === "unavailable") return null;
  const event = gate.activeEvents[0] ?? gate.nextEvent;
  if (!event) return null;
  const phase = event.phase === "active_shock" ? "Active Shock" : "Scheduled Risk";
  return `⚠ ${eventKindLabel(event.kind)} ${formatEventTime(event.occurredAt)} ET · ${phase}`;
}

function structureRegimeLabel(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  const g = gammaFor(view, symbol);
  const regime = g?.regime?.toLowerCase() ?? "";
  if (regime.includes("positive")) return "POSITIVE GAMMA";
  if (regime.includes("negative")) return "NEGATIVE GAMMA";
  if (regime.includes("near_zero") || regime.includes("near zero")) return "NEAR ZERO GAMMA";
  return "GAMMA STRUCTURE";
}

function gammaDataLabel(
  g: V2CommandCenterPageView["gamma"][number],
  lang: V2Language,
) {
  const date = g.sessionDate ?? "—";
  const expiry = g.expiration ?? "—";
  return lang === "zh"
    ? `期权数据 · ${date} 收盘 · 到期 ${expiry}`
    : `Options data · ${date} close · Exp ${expiry}`;
}

function StructureCard({
  view,
  symbol,
  lang,
}: {
  view: V2CommandCenterPageView;
  symbol: "SPY" | "QQQ";
  lang: V2Language;
}) {
  const g = gammaFor(view, symbol);
  const cone = coneFor(view, symbol);
  if (!g) return null;

  const activeCone =
    cone?.restOfDay.status === "available" ? cone.restOfDay : cone?.fullSession;
  const core = activeCone?.coreRange50 ?? null;
  const expected = activeCone?.expectedRange90 ?? null;
  const values = [
    g.callWall,
    g.spot,
    g.gammaFlip,
    g.putWall,
    expected?.lower,
    expected?.upper,
    core?.lower,
    core?.upper,
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const expectedLeft = expected ? levelPct(expected.lower, values) : 0;
  const expectedWidth = expected
    ? levelPct(expected.upper, values) - expectedLeft
    : 0;
  const coreLeft = core ? levelPct(core.lower, values) : 0;
  const coreWidth = core ? levelPct(core.upper, values) - coreLeft : 0;

  const rows = [
    ["CALL WALL", g.callWall, GOOD],
    ["SPOT", g.spot, "#16264c"],
    ["GAMMA FLIP", g.gammaFlip, BLUE],
    ["PUT WALL", g.putWall, BAD],
  ] as const;

  return (
    <article className="pv-structure-card">
      <div className="pv-symbol-head">
        <div className="pv-symbol-line">
          <strong>{symbol}</strong>
          <span className="pv-price">{fmt(g.spot, 2)}</span>
        </div>
        <div className="pv-regime">{structureRegimeLabel(view, symbol)}</div>
      </div>
      <div className="pv-data-date">{gammaDataLabel(g, lang)}</div>

      <div className="pv-structure-grid">
        <div className="pv-level-labels">
          {rows.map(([label, value, color]) => {
            const delta = label === "SPOT" ? null : distanceFromSpotPct(value, g.spot);
            return (
              <div key={label}>
                <i style={{ background: color }} />
                <span>{label}</span>
                <strong>{fmt(value, value != null && value % 1 ? 2 : 0)}</strong>
                <em
                  className={
                    delta == null ? "" : delta > 0 ? "good" : delta < 0 ? "bad" : ""
                  }
                >
                  {delta == null ? "" : signed(delta, "%", 2)}
                </em>
              </div>
            );
          })}
        </div>

        <div className="pv-chart">
          {expected ? (
            <div
              className="pv-band expected"
              style={{
                left: `${expectedLeft}%`,
                width: `${Math.max(expectedWidth, 1)}%`,
              }}
            />
          ) : null}
          {core ? (
            <div
              className="pv-band core"
              style={{ left: `${coreLeft}%`, width: `${Math.max(coreWidth, 1)}%` }}
            />
          ) : null}
          {rows.map(([label, value, color], index) =>
            value != null ? (
              <div
                className="pv-axis"
                key={label}
                style={{ top: `${12 + index * 24}%`, borderColor: color }}
              >
                <span
                  className="pv-dot"
                  style={{ left: `${levelPct(value, values)}%`, background: color }}
                />
              </div>
            ) : null,
          )}
        </div>
      </div>

      <div className="pv-cone-legend">
        <span>
          <b className="swatch expected" />90% Expected Range <strong>{bandText(expected)}</strong>
        </span>
        <span>
          <b className="swatch core" />50% Core Range <strong>{bandText(core)}</strong>
        </span>
      </div>

      <div className="pv-touch-row">
        <span>
          Call Wall Touch <strong className="good">{g.callWallTouch.percent == null ? "—" : `${g.callWallTouch.percent}%`}</strong>
        </span>
        <span>
          Put Wall Touch <strong className="bad">{g.putWallTouch.percent == null ? "—" : `${g.putWallTouch.percent}%`}</strong>
        </span>
        <span>
          Dealer Flow <strong>{g.dealerFlowRegime?.toLowerCase().includes("stabilizing") ? "Supportive" : g.regime ?? "—"}</strong>
        </span>
      </div>
    </article>
  );
}

function signalTone(signal: string | null | undefined) {
  if (!signal) return "";
  const normalized = signal.toLowerCase();
  if (["strong", "buying", "positive", "vol_underpriced"].some((token) => normalized.includes(token))) return "good";
  if (["weak", "selling", "negative", "vol_expensive"].some((token) => normalized.includes(token))) return "bad";
  return "";
}

function FlowSection({ view }: { view: V2CommandCenterPageView }) {
  const spy = gammaFor(view, "SPY");
  const qqq = gammaFor(view, "QQQ");
  const rows = [
    ["SPY Breadth (Adv/Dec)", view.spyBreadth.advancingPct == null ? "—" : `${fmt(view.spyBreadth.advancingPct)}%`, view.spyBreadth.breadthSignal ?? "—"],
    ["QQQ Breadth (Adv/Dec)", view.qqqBreadth.advancingPct == null ? "—" : `${fmt(view.qqqBreadth.advancingPct)}%`, view.qqqBreadth.breadthSignal ?? "—"],
    ["CTA Proxy", view.ctaProxy.signal ?? "—", view.ctaProxy.signal ?? ""],
    ["IV - HV (SPY)", signed(spy?.volMispricing.spreadVolPts), spy?.volMispricing.signal ?? ""],
    ["IV - HV (QQQ)", signed(qqq?.volMispricing.spreadVolPts), qqq?.volMispricing.signal ?? ""],
    ["Net Gamma (SPY)", spy?.netGex == null ? "—" : `${(spy.netGex / 1e9).toFixed(1)}B`, spy?.regime ?? ""],
    ["Net Gamma (QQQ)", qqq?.netGex == null ? "—" : `${(qqq.netGex / 1e9).toFixed(1)}B`, qqq?.regime ?? ""],
  ];

  return (
    <section className="pv-flat pv-flow">
      <h3>FLOW / PARTICIPATION</h3>
      {rows.map(([label, value, signal]) => (
        <div className="pv-metric-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <em className={signalTone(signal)}>{signal}</em>
        </div>
      ))}
      <div className="pv-flat-footer">
        Participation: <strong>{view.spyBreadth.breadthSignal === "strong" ? "Expanding" : view.spyBreadth.breadthSignal ?? "—"}</strong>
      </div>
    </section>
  );
}

function RotationSection({ view }: { view: V2CommandCenterPageView }) {
  const sectors = [...view.sectorRotation.sectors]
    .sort((a, b) => b.rs5d - a.rs5d)
    .slice(0, 8);
  const max = Math.max(0.5, ...sectors.map((row) => Math.abs(row.rs5d)));

  return (
    <section className="pv-flat pv-rotation">
      <h3>SECTOR ROTATION <small>(5D vs SPY)</small></h3>
      {sectors.length === 0 ? <p className="pv-muted">{view.sectorRotation.missingReason ?? "Unavailable"}</p> : sectors.map((row) => (
        <div className="pv-rotation-row" key={row.symbol}>
          <span>{row.symbol} · {SECTOR_NAMES[row.symbol] ?? row.symbol}</span>
          <strong className={row.rs5d >= 0 ? "good" : "bad"}>{signed(row.rs5d, "%")}</strong>
          <i>
            <b
              className={row.rs5d >= 0 ? "pos" : "neg"}
              style={{ width: `${Math.max(8, (Math.abs(row.rs5d) / max) * 100)}%` }}
            />
          </i>
        </div>
      ))}
    </section>
  );
}

function TechnologySection({ view }: { view: V2CommandCenterPageView }) {
  const rows = view.technologyInternal.rows;
  const max = Math.max(0.5, ...rows.map((row) => Math.abs(row.rs5dVsXlk)));
  const average = rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.rs5dVsXlk, 0) / rows.length;
  return (
    <section className="pv-flat pv-tech">
      <h3>TECHNOLOGY INTERNAL <small>(5D vs XLK)</small></h3>
      {rows.length === 0 ? (
        <p className="pv-muted">{view.technologyInternal.missingReason ?? "Unavailable"}</p>
      ) : (
        rows.map((row) => (
          <div className="pv-rotation-row" key={row.symbol}>
            <span>{row.label} ({row.symbol})</span>
            <strong className={row.rs5dVsXlk >= 0 ? "good" : "bad"}>{signed(row.rs5dVsXlk, "%")}</strong>
            <i>
              <b
                className={row.rs5dVsXlk >= 0 ? "pos" : "neg"}
                style={{ width: `${Math.max(8, (Math.abs(row.rs5dVsXlk) / max) * 100)}%` }}
              />
            </i>
          </div>
        ))
      )}
      <div className="pv-flat-footer">
        Tech Strength: <strong className={average == null ? "" : average >= 0 ? "good" : "bad"}>{average == null ? "—" : average >= 0 ? "Outperforming" : "Underperforming"}</strong>
      </div>
    </section>
  );
}

function TechLeadersLaggards({ view }: { view: V2CommandCenterPageView }) {
  const data = view.techLeadersLaggards;
  return (
    <section className="pv-leaders">
      <h3>TECH LEADERS & LAGGARDS <small>(1D)</small></h3>
      {data.leaders.length === 0 && data.laggards.length === 0 ? (
        <p className="pv-muted">{data.missingReason ?? "Unavailable"}</p>
      ) : (
        <div className="pv-leaders-grid">
          <div>
            <h4>Top 5 Leaders</h4>
            <div className="pv-ticker-cards">
              {data.leaders.map((row) => (
                <span key={row.symbol}><b>{row.symbol}</b><strong className="good">{signed(row.return1dPct, "%", 2)}</strong></span>
              ))}
            </div>
          </div>
          <div>
            <h4 className="bad">Top 5 Laggards</h4>
            <div className="pv-ticker-cards">
              {data.laggards.map((row) => (
                <span key={row.symbol}><b>{row.symbol}</b><strong className="bad">{signed(row.return1dPct, "%", 2)}</strong></span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function KeyDrivers({ view }: { view: V2CommandCenterPageView }) {
  const lines: { label: string; tone: "good" | "bad" | "neutral" }[] = [];
  const event = scheduledEventLine(view);
  if (event) lines.push({ label: event, tone: "bad" });

  const breadth = view.spyBreadth.breadthSignal;
  if (breadth) lines.push({ label: `Breadth · ${breadth}`, tone: breadth === "strong" ? "good" : breadth === "weak" ? "bad" : "neutral" });
  if (view.ctaProxy.signal) lines.push({ label: `CTA · ${view.ctaProxy.signal}`, tone: signalTone(view.ctaProxy.signal) === "bad" ? "bad" : signalTone(view.ctaProxy.signal) === "good" ? "good" : "neutral" });
  const spy = gammaFor(view, "SPY");
  if (spy?.regime) lines.push({ label: `SPY Gamma · ${spy.regime.replaceAll("_", " ")}`, tone: spy.regime.includes("negative") ? "bad" : spy.regime.includes("positive") ? "good" : "neutral" });
  if (view.macroSummary?.label) lines.push({ label: view.macroSummary.label, tone: view.macroSummary.riskDirection?.toLowerCase().includes("risk_off") ? "bad" : "neutral" });

  const conf = confidencePct(view.aiStudy.confidence);
  return (
    <>
      <ul className="pv-drivers">
        {lines.slice(0, 5).map((line) => (
          <li key={line.label} className={line.tone === "neutral" ? "" : line.tone}>
            <b>{line.tone === "bad" ? "↓" : line.tone === "good" ? "↑" : "•"}</b>
            <span>{line.label}</span>
          </li>
        ))}
      </ul>
      <div className="pv-mini-confidence">
        <span>Confidence</span>
        <i><b style={{ width: `${conf}%` }} /></i>
        <strong>{view.aiStudy.confidence}</strong>
      </div>
    </>
  );
}

function AiRail({ view, lang }: { view: V2CommandCenterPageView; lang: V2Language }) {
  const coverage = summarizeV2AiStudyInputCoverage(view, view.eventGate);
  const coveragePct = Math.round((coverage.available / coverage.total) * 100);
  const confidenceLabel = aiStudyConfidenceLabel(view.aiStudy.confidence, lang);
  const review = view.dailyReview;
  const pendingLabel = lang === "zh" ? "待定" : "Pending";

  return (
    <aside className="pv-right">
      <section className="pv-ai" id="ai-study">
        <h2>{lang === "zh" ? "AI 研究 / 洞察" : "AI STUDY / INSIGHTS"}</h2>
        <h4>{lang === "zh" ? "AI 观点" : "AI VIEW"}</h4>
        <p>{view.aiStudy.baseCase}</p>
        <h4>{lang === "zh" ? "关键价位" : "KEY LEVELS TO WATCH"}</h4>
        <ul>
          {view.gamma.map((g) => (
            <li key={g.symbol}><strong>{g.symbol}</strong> Call {fmt(g.callWall)} · Flip {fmt(g.gammaFlip)} · Put {fmt(g.putWall)}</li>
          ))}
        </ul>
        <h4>{lang === "zh" ? "多头情景" : "BULL CASE"}</h4>
        <p>{view.aiStudy.ifThen}</p>
        <h4>{lang === "zh" ? "空头情景" : "BEAR CASE"}</h4>
        <p>{view.aiStudy.invalidation}</p>
        <div className="pv-confidence">
          <div>
            <strong>{lang === "zh" ? "置信度" : "CONFIDENCE"}</strong>
            <span>{confidenceLabel}</span>
          </div>
          <div>
            <strong>{lang === "zh" ? "数据覆盖" : "DATA COVERAGE"}</strong>
            <span>
              {coverage.available}/{coverage.total}{lang === "zh" ? " 项输入" : " inputs"}
            </span>
          </div>
          <i><b style={{ width: `${coveragePct}%` }} /></i>
        </div>
      </section>

      <section className="pv-review" id="daily-review">
        <h2>{lang === "zh" ? "每日复盘" : "DAILY REVIEW"}</h2>
        <div>
          <strong>{lang === "zh" ? "早盘立场" : "Morning stance"}</strong>
          <span>{review.morningStance ?? view.stance ?? "—"}</span>
        </div>
        <div>
          <strong>{lang === "zh" ? "实际结果" : "Actual outcome"}</strong>
          <span>{review.actualOutcome || pendingLabel}</span>
        </div>
        <div className="pv-review-block">
          <strong>{lang === "zh" ? "有效部分" : "What worked"}</strong>
          {review.whatWorked.length > 0 ? (
            <ul className="pv-review-list is-positive">
              {review.whatWorked.map((line) => (
                <li key={line}>✅ {line}</li>
              ))}
            </ul>
          ) : (
            <span className="pv-review-pending">{pendingLabel}</span>
          )}
        </div>
        {review.whatFailed.length > 0 ? (
          <div className="pv-review-block">
            <strong>{lang === "zh" ? "失效部分" : "What failed"}</strong>
            <ul className="pv-review-list is-caution">
              {review.whatFailed.map((line) => (
                <li key={line}>⚠ {line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <strong>{lang === "zh" ? "明日关注" : "Tomorrow watch"}</strong>
          <span>{review.tomorrowWatch[0] ?? pendingLabel}</span>
        </div>
      </section>
    </aside>
  );
}

function marketStatusLabel(lang: V2Language) {
  const status = resolveAiStudyMarketStatus(new Date());
  if (status === "regular_session_open") return lang === "zh" ? "● 市场开盘" : "● Market Open";
  if (status === "premarket") return lang === "zh" ? "● 盘前" : "● Premarket";
  return lang === "zh" ? "● 已收盘" : "● Market Closed";
}

export function CommandCenterPreview({
  view,
  lang,
  demoMode = false,
}: {
  view: V2CommandCenterPageView;
  lang: V2Language;
  demoMode?: boolean;
}) {
  const stance = stanceLabel(view.stance, lang);
  const trend = view.riskDivergenceTrend?.toUpperCase() ?? "—";
  const hb = view.allocation?.highBeta;
  const home = demoMode ? "/demo" : "/";
  const languageHref = (nextLang: V2Language) => `${home}?lang=${nextLang}`;

  return (
    <div className="pv-app">
      <style>{styles}</style>
      <aside className="pv-nav">
        <a className="pv-logo" href={home}>G</a>
        <nav>
          <a className="active" href="#overview">▦ <span>Overview</span></a>
          <a href="#structure">⌁ <span>Market Structure</span></a>
          <a href="#flow">⌁ <span>Flow / Participation</span></a>
          <a href="#rotation">↻ <span>Rotation</span></a>
          <a href="#ai-study">✦ <span>AI Study</span></a>
          <a href="#daily-review">□ <span>Daily Review</span></a>
        </nav>
        <div className="pv-language-switch" aria-label="Language">
          <a className={lang === "en" ? "active" : ""} href={languageHref("en")}>EN</a>
          <span>|</span>
          <a className={lang === "zh" ? "active" : ""} href={languageHref("zh")}>中文</a>
        </div>
      </aside>

      <div className="pv-shell">
        <header className="pv-top">
          <strong>GammaDesk</strong>
          <div className="pv-tickers">
            {(["SPY", "QQQ", "IWM", "DIA", "VIX", "TLT", "GLD", "BTC"] as const).map((symbol) => <Ticker key={symbol} view={view} symbol={symbol} />)}
          </div>
          <div className="pv-open">{marketStatusLabel(lang)}</div>
        </header>

        <main className="pv-main">
          <div className="pv-center">
            <section id="overview">
              <h2 className="pv-section-title">OVERVIEW</h2>
              <div className="pv-overview">
                <article>
                  <h3>MARKET STANCE</h3>
                  <strong className="pv-hero">{stance}</strong>
                  <p>{stanceSummary(view, lang)}</p>
                </article>

                <article>
                  <h3>SENTIMENT / RISK</h3>
                  <div className="pv-gauge"><div className="arc" /><b>{view.riskScore ?? "—"}</b></div>
                  <p className="center">{riskLabel(view.riskScore, lang)}</p>
                  <small className="pv-risk-asof">{lang === "zh" ? "数据日期" : "as of"} {view.sessionDate ?? "—"}</small>
                </article>

                <article>
                  <h3>RISK SNAPSHOT</h3>
                  <div className="pv-snapshot">
                    <span>QQQ vs SPY Spread</span>
                    <strong>{formatRiskDivergenceValue(view.riskDivergence)}</strong>
                    <b className={view.riskDivergenceTrend === "widening" ? "bad" : "good"}>{trend}</b>
                    <small>High Beta: <em>{highBetaAction(view)}</em>{hb == null ? "" : ` · Target ${hb}%`}</small>
                  </div>
                </article>

                <article>
                  <h3>RECOMMENDED EXPOSURE</h3>
                  <strong className="pv-hero">{view.exposure ? `${view.exposure.min}–${view.exposure.max}%` : "—"}</strong>
                  <p className="center">of max risk</p>
                  <div className="pv-exposure"><b style={{ width: `${view.exposure ? Math.min(100, (view.exposure.min + view.exposure.max) / 2) : 0}%` }} /></div>
                </article>

                <article>
                  <h3>KEY DRIVERS</h3>
                  <KeyDrivers view={view} />
                </article>
              </div>
            </section>

            <section id="structure" className="pv-structure">
              <h2 className="pv-section-title">MARKET STRUCTURE <small>(OPTION LEVELS)</small></h2>
              <div className="pv-structure-cards"><StructureCard view={view} symbol="SPY" lang={lang} /><StructureCard view={view} symbol="QQQ" lang={lang} /></div>
            </section>

            <div className="pv-bottom-row">
              <div id="flow"><FlowSection view={view} /></div>
              <div id="rotation"><RotationSection view={view} /></div>
              <TechnologySection view={view} />
            </div>

            <TechLeadersLaggards view={view} />
          </div>

          <AiRail view={view} lang={lang} />
        </main>
      </div>
    </div>
  );
}

const styles = `
:root{--pv-blue:#004fff;--pv-text:#10214a;--pv-muted:#65728d;--pv-line:#dce6f3;--pv-good:#0a963f;--pv-bad:#ff2e2e}
*{box-sizing:border-box}.pv-app{min-height:100vh;background:#fff;color:var(--pv-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;grid-template-columns:118px 1fr;font-size:12px}.pv-nav{border-right:1px solid var(--pv-line);padding:14px 10px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;background:#fff}.pv-logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#7b61ff,#004fff);display:grid;place-items:center;color:#fff;font-weight:850;font-size:18px;text-decoration:none;margin:0 auto 22px}.pv-nav nav{display:grid;gap:7px}.pv-nav nav a{display:flex;gap:9px;align-items:center;color:#18305e;text-decoration:none;padding:10px 9px;border-radius:7px;font-weight:700}.pv-nav nav a.active{background:#edf4ff;color:var(--pv-blue)}.pv-shell{min-width:0}.pv-top{height:48px;border-bottom:1px solid var(--pv-line);display:grid;grid-template-columns:145px 1fr 110px;align-items:center;padding:0 14px;position:sticky;top:0;background:#fff;z-index:8}.pv-top>strong{font-size:18px}.pv-tickers{display:flex;gap:28px;align-items:center;justify-content:center}.pv-ticker{display:flex;gap:5px;align-items:baseline;justify-content:center;white-space:nowrap;font-size:9px}.pv-ticker b{font-size:9px}.pv-ticker strong{font-size:9px}.pv-ticker em{font-style:normal;font-weight:800;font-size:8px}.pv-open{color:#153257;font-weight:800;font-size:10px;white-space:nowrap}.pv-main{display:grid;grid-template-columns:minmax(780px,1fr) 310px;gap:10px;padding:10px}.pv-center{min-width:0}.pv-section-title{font-size:15px;color:var(--pv-blue);margin:0 0 7px;font-weight:850}.pv-section-title small{font-size:9px}.pv-overview{display:grid;grid-template-columns:1.05fr .95fr .95fr 1fr 1.12fr;gap:7px}.pv-overview>article{border:1px solid var(--pv-line);border-radius:7px;min-height:166px;padding:13px 13px 11px;background:#fff}.pv-overview h3,.pv-flat h3,.pv-leaders h3{font-size:11px;margin:0 0 14px;font-weight:850}.pv-hero{display:block;color:var(--pv-blue);font-size:30px;line-height:1.05;margin:23px 0 11px;text-align:center}.pv-overview p{font-size:10px;line-height:1.55;color:#25365c}.pv-overview p.center{text-align:center}.pv-risk-asof{display:block;text-align:center;color:var(--pv-muted);font-size:9px;margin-top:4px}.pv-gauge{position:relative;height:88px;width:150px;margin:7px auto 0;overflow:hidden}.pv-gauge .arc{width:140px;height:140px;border:14px solid #e8edf5;border-bottom-color:transparent;border-left-color:#ff4242;border-top-color:#ffad16;border-right-color:#1da358;border-radius:50%;transform:rotate(-45deg);margin:8px auto}.pv-gauge b{position:absolute;left:0;right:0;bottom:2px;text-align:center;font-size:28px}.pv-snapshot{text-align:center;display:grid;gap:7px}.pv-snapshot>span{font-weight:750}.pv-snapshot>strong{font-size:30px;color:var(--pv-bad);margin-top:7px}.pv-snapshot small{border-top:1px solid var(--pv-line);padding-top:9px}.pv-snapshot em{font-style:normal;color:var(--pv-bad);font-weight:850}.pv-exposure{height:7px;border-radius:99px;background:#e8edf4;overflow:hidden;margin:21px 4px 0}.pv-exposure b{display:block;height:100%;background:var(--pv-good)}.pv-drivers{list-style:none;margin:0;padding:0;display:grid;gap:7px;font-size:9px}.pv-drivers li{font-weight:800;display:flex;gap:5px}.pv-drivers li span{color:#22345a;font-weight:650}.pv-mini-confidence{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:6px;margin-top:10px;font-size:9px}.pv-mini-confidence i,.pv-confidence i{height:5px;background:#e8edf4;border-radius:99px;overflow:hidden}.pv-mini-confidence i b,.pv-confidence i b{display:block;height:100%;background:var(--pv-blue)}.good{color:var(--pv-good)!important}.bad{color:var(--pv-bad)!important}.pv-structure{margin-top:9px;border:1px solid var(--pv-line);border-radius:7px;padding:9px}.pv-structure-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pv-structure-card{min-width:0;padding:6px 9px 4px}.pv-structure-card:first-child{border-right:1px solid var(--pv-line)}.pv-symbol-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.pv-symbol-line{display:flex;gap:8px;align-items:baseline;min-width:max-content}.pv-symbol-line strong{font-size:16px}.pv-price{font-size:15px;font-weight:550;color:#31415f}.pv-regime{font-size:9px;background:#edf4ff;color:var(--pv-blue);padding:4px 9px;border-radius:4px;font-weight:700;white-space:nowrap}.pv-data-date{font-size:8.5px;color:var(--pv-muted);margin:3px 0 7px}.pv-structure-grid{display:grid;grid-template-columns:160px 1fr;gap:8px;min-height:112px}.pv-level-labels{display:grid;grid-template-rows:repeat(4,1fr)}.pv-level-labels>div{display:grid;grid-template-columns:8px 1fr 45px 50px;align-items:center;gap:5px;font-size:9px}.pv-level-labels i{width:6px;height:6px;border-radius:50%}.pv-level-labels strong{text-align:right}.pv-level-labels em{font-style:normal;text-align:right;font-weight:750}.pv-chart{position:relative;border-bottom:1px solid #d6e0ef;overflow:hidden;background:repeating-linear-gradient(to right,transparent 0,transparent calc(20% - 1px),#edf2f8 calc(20% - 1px),#edf2f8 20%)}.pv-axis{position:absolute;left:0;right:0;border-top:1px solid;z-index:2}.pv-dot{position:absolute;width:8px;height:8px;border-radius:50%;top:-4px;transform:translateX(-50%)}.pv-band{position:absolute;top:6%;bottom:6%;border-radius:2px;z-index:1}.pv-band.expected{background:rgba(55,126,255,.10)}.pv-band.core{background:rgba(55,126,255,.22)}.pv-cone-legend{display:flex;gap:18px;border-top:1px solid #edf1f7;margin-top:5px;padding:7px 4px 3px;font-size:8px}.pv-cone-legend span{display:flex;gap:5px;align-items:center}.swatch{width:13px;height:9px;display:inline-block;border:1px solid #c8d8f3}.swatch.expected{background:rgba(55,126,255,.10)}.swatch.core{background:rgba(55,126,255,.25)}.pv-touch-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #edf1f7;margin-top:3px;padding-top:7px;font-size:8px}.pv-touch-row span{text-align:center;border-right:1px solid #edf1f7}.pv-touch-row span:last-child{border-right:0}.pv-bottom-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:7px}.pv-flat{height:205px;border:1px solid var(--pv-line);border-radius:7px;padding:10px;background:#fff;overflow:hidden;position:relative}.pv-flat h3,.pv-leaders h3{color:var(--pv-blue);font-size:12px;margin-bottom:9px}.pv-flat h3 small,.pv-leaders h3 small{font-size:8px}.pv-metric-row{display:grid;grid-template-columns:1.4fr .55fr .75fr;gap:4px;align-items:center;padding:3px 0;font-size:8px}.pv-metric-row em{font-style:normal;color:var(--pv-muted);text-align:right}.pv-rotation-row{display:grid;grid-template-columns:1.55fr .5fr .7fr;gap:5px;align-items:center;padding:3px 0;font-size:8px}.pv-rotation-row i{height:5px;background:#edf1f6;border-radius:9px;overflow:hidden}.pv-rotation-row b{display:block;height:100%}.pv-rotation-row b.pos{background:#0a963f}.pv-rotation-row b.neg{background:#ff2e2e}.pv-muted{color:var(--pv-muted);font-size:9px;line-height:1.5}.pv-flat-footer{position:absolute;left:10px;right:10px;bottom:8px;border-top:1px solid #edf1f7;padding-top:7px;font-size:8px}.pv-leaders{border:1px solid var(--pv-line);border-radius:7px;padding:9px 10px;margin-top:7px;min-height:82px}.pv-leaders-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}.pv-leaders h4{font-size:8px;margin:0 0 5px;color:var(--pv-good)}.pv-ticker-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.pv-ticker-cards span{display:flex;flex-direction:column;border-right:1px solid #edf1f7;padding-right:5px;font-size:8px}.pv-ticker-cards strong{font-size:8px}.pv-right{background:#f8fbff;border-left:1px solid #e2ebf7;min-height:calc(100vh - 68px);padding:9px;display:grid;grid-template-rows:auto auto;align-content:start;gap:8px}.pv-ai,.pv-review{background:#fff;border:1px solid var(--pv-line);border-radius:7px;padding:13px}.pv-ai h2,.pv-review h2{color:var(--pv-blue);font-size:15px;margin:0 0 13px;padding-bottom:8px;border-bottom:1px solid #e5edf8}.pv-ai h4{font-size:9px;color:var(--pv-blue);margin:13px 0 5px}.pv-ai p,.pv-ai li{font-size:9px;line-height:1.55;color:#27385c}.pv-ai ul{padding-left:15px}.pv-confidence{border-top:1px solid #e5edf8;margin-top:13px;padding-top:9px}.pv-confidence>div{display:flex;justify-content:space-between;font-size:9px;gap:8px}.pv-confidence i{display:block;margin-top:7px;height:5px}.pv-review>div{display:grid;grid-template-columns:1fr;gap:2px;padding:9px 0;border-bottom:1px solid #edf1f7;font-size:9px}.pv-review span{color:var(--pv-muted)}.pv-review-block{display:grid;gap:4px}.pv-review-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}.pv-review-list.is-positive li{color:var(--pv-good)}.pv-review-list.is-caution li{color:var(--pv-bad)}.pv-review-pending{color:var(--pv-muted)}
@media(max-width:1180px){.pv-app{grid-template-columns:72px 1fr}.pv-nav span{display:none}.pv-main{grid-template-columns:1fr}.pv-right{display:none}.pv-overview{grid-template-columns:repeat(3,1fr)}.pv-bottom-row{grid-template-columns:1fr 1fr}.pv-tickers span:nth-child(n+6){display:none}}
`;
