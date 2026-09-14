import { MarketConsider } from "./MarketConsider";
import { OverviewCards } from "./OverviewCards";
import { HomeManualGammaInput } from "./MarketDetailPreview";
import { Suspense, type ReactNode } from "react";
import type { V2CommandCenterPageView, V2HomeNarratives } from "@/desk/load-v2-home";
import type { V2Language, V2GammaSummary, V2SpyBreadthSummary } from "@/desk/v2-command-center";
import { selectNewsFeedCatalysts } from "@/catalyst/public-feed";
import { resolveAiStudyMarketStatus } from "@/ai-study/session";
import styles from "./DarkCommandCenter.module.css";

const number = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(digits);
const signed = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
const tone = (n: number) => n >= 0 ? styles.good : styles.bad;
const names: Record<string, [string, string]> = {
  XLK: ["Technology", "科技"], XLE: ["Energy", "能源"], XLF: ["Financials", "金融"],
  XLV: ["Health Care", "医疗"], XLI: ["Industrials", "工业"], XLY: ["Consumer Discretionary", "可选消费"],
  XLP: ["Consumer Staples", "必需消费"], XLU: ["Utilities", "公用事业"], XLB: ["Materials", "材料"],
  XLRE: ["Real Estate", "房地产"], XLC: ["Communication", "通信"],
  SMH: ["Semiconductors", "半导体"], IGV: ["Software", "软件"], MAG7: ["MAG7 Basket", "七巨头组合"],
  CLOU: ["Cloud", "云计算"], HACK: ["Cybersecurity", "网络安全"], AIQ: ["AI Infrastructure", "AI 基础设施"],
};
function label(value: string | null | undefined, lang: V2Language) {
  if (!value) return "—";
  const labels: Record<string, string> = {
    positive: "正 Gamma", negative: "负 Gamma", near_zero: "接近零 Gamma",
    strong: "强", mixed: "分化", weak: "弱", clear: "低", scheduled_risk: "事件临近",
    active_shock: "事件冲击", unavailable: "暂无数据", stabilizing: "抑制波动",
    destabilizing: "放大波动", neutral: "中性", buying: "买入", selling: "卖出",
    high: "高", moderate: "中等", limited: "有限", buy: "买入", hold: "持有", reduce: "减仓",
    ready: "就绪", partial: "部分覆盖", available: "可用", incomplete: "不完整",
  };
  return lang === "zh" ? labels[value.toLowerCase()] ?? value.replaceAll("_", " ") : value.replaceAll("_", " ");
}
function Panel({ title, children, id, note }: { title: string; children: ReactNode; id?: string; note?: string }) {
  return <section className={styles.panel} id={id}><header className={styles.panelHead}><h2>{title}</h2>{note && <small>{note}</small>}</header>{children}</section>;
}
function LevelCard({ g, lang, cone }: { g: V2GammaSummary; lang: V2Language; cone: V2CommandCenterPageView["gammaCone"][number] | undefined }) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const range = cone?.restOfDay.status === "available" ? cone.restOfDay : cone?.fullSession;
  const rangeLabel = cone?.restOfDay.status === "available" ? t("Rest of day", "剩余交易时段") : t("Full session", "完整交易日");
  const levels = [g.spot, g.callWall, g.gammaFlip, g.putWall].filter((n): n is number => n != null && Number.isFinite(n));
  const min = Math.min(...levels), max = Math.max(...levels);
  const pct = (n: number) => 4 + 92 * (max === min ? .5 : (n - min) / (max - min));
  const entries = [[t("Spot", "现价"), g.spot], ["Call Wall", g.callWall], ["Gamma Flip", g.gammaFlip], ["Put Wall", g.putWall]] as const;
  return <Panel title={`${g.symbol} ${t("Market Structure", "市场结构")}`} note={label(g.regime, lang)}>
    <div className={styles.metrics}>{entries.map(([name, value]) => <div key={name}><small>{name}</small><strong>{number(value, 2)}</strong></div>)}</div>
    {levels.length > 1 && max > min ? <div className={styles.levelMap} aria-label={t("Option levels on a price scale", "期权价位分布")}>
      <div className={styles.levelTrack} />
      {entries.map(([name, value], i) => value == null ? null : <span key={name} className={i === 0 ? styles.spotMarker : styles.levelMarker} style={{ left: `${pct(value)}%` }} title={`${name}: ${number(value, 2)}`} />)}
      <div className={styles.scale}><span>{levels.length ? number(min, 2) : "—"}</span><span>{t("Spot", "现价")} {number(g.spot, 2)}</span><span>{levels.length ? number(max, 2) : "—"}</span></div>
    </div>
    : <p>{t("Option levels unavailable", "期权价位暂不可用")}</p>}
    <div className={styles.metricsThree}><div><small>{t("Dealer Flow", "做市商对冲")}</small><b>{label(g.dealerFlowRegime, lang)}</b></div><div><small>IV − HV</small><b>{number(g.volMispricing.spreadVolPts, 1)} vol</b></div><div><small>ROD ({number(g.restOfDayRange.confidencePct)}%)</small><b>{g.restOfDayRange.status === "available" ? `${number(g.restOfDayRange.lower)} – ${number(g.restOfDayRange.upper)}` : t("Unavailable / closed", "暂无数据／已收盘")}</b></div></div>
    <p className={styles.meta}>{t("Options as of", "期权数据日期")} {g.sessionDate ?? "—"} · {t("Expiry", "到期")} {g.expiration ?? "—"} · {g.isFixture ? t("Illustrative", "示意数据") : label(g.status, lang)} {g.freshness ? `· ${label(g.freshness, lang)}` : ""}</p>
    <p className={styles.meta}>{g.quality}</p>
    <details className={styles.details}><summary>{t("Positioning & range details", "持仓与区间详情")}</summary>
      <p>{rangeLabel}</p><dl className={styles.rows}><div><dt>{t("90% expected range", "90% 预期区间")}</dt><dd>{range?.expectedRange90 ? `${number(range.expectedRange90.lower)} – ${number(range.expectedRange90.upper)}` : "—"}</dd></div><div><dt>{t("50% core range", "50% 核心区间")}</dt><dd>{range?.coreRange50 ? `${number(range.coreRange50.lower)} – ${number(range.coreRange50.upper)}` : "—"}</dd></div><div><dt>Net GEX</dt><dd>{number(g.netGex, 0)}</dd></div><div><dt>{t("Call wall touch", "触及 Call Wall")}</dt><dd>{number(g.callWallTouch.percent)}%</dd></div><div><dt>{t("Put wall touch", "触及 Put Wall")}</dt><dd>{number(g.putWallTouch.percent)}%</dd></div></dl>
      {g.contextLines.map((line, i) => <p key={i}>{line}</p>)}
      <p>{t("Gamma describes volatility amplification or compression, not price direction.", "Gamma 描述波动的放大或抑制，不单独预测涨跌方向。")}</p>
    </details>
  </Panel>;
}
function Breadth({ data, symbol, lang }: { data: V2SpyBreadthSummary; symbol: string; lang: V2Language }) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const p = data.percentAboveMA20;
  const rows = [[t("Above MA20", "高于 MA20"), p, "%"], [t("Above MA50", "高于 MA50"), data.percentAboveMA50, "%"],
    [t("Advancing", "上涨家数"), data.advance, ""], [t("Declining", "下跌家数"), data.decline, ""],
    [t("New 20D closing high", "20日收盘新高"), data.new20DayClosingHigh, "%"],
    [t("New 20D closing low", "20日收盘新低"), data.new20DayClosingLow, "%"]] as const;
  return <div><h3>{symbol} <small>{label(data.breadthSignal, lang)}</small></h3><div className={styles.breadth}>
    <div className={styles.ring} style={{ background: `conic-gradient(#278cff ${Math.max(0, Math.min(100, p ?? 0))}%, #203246 0)` }}><div><strong>{number(p)}{p != null ? "%" : ""}</strong><small>{t("Above MA20", "高于 MA20")}</small></div></div>
    <dl className={styles.rows}>{rows.map(([name, n, unit]) => <div key={name}><dt>{name}</dt><dd>{number(n)}{n == null ? "" : unit}</dd></div>)}</dl>
  </div><p className={styles.meta}>{data.marketSessionDate ?? "—"} · {data.stale ? t("Stale snapshot", "历史快照") : label(data.status, lang)}</p></div>;
}
function Bars({ rows, lang }: { rows: readonly { symbol: string; value: number }[]; lang: V2Language }) {
  const max = Math.max(.5, ...rows.map(r => Math.abs(r.value)));
  return rows.length ? <div className={styles.bars}>{rows.map(r => <div className={styles.barRow} key={r.symbol}>
    <b>{r.symbol}</b><span>{names[r.symbol]?.[lang === "zh" ? 1 : 0] ?? r.symbol}</span><strong className={tone(r.value)}>{signed(r.value)}</strong>
    <div className={styles.barTrack}><i className={r.value >= 0 ? styles.positiveBar : styles.negativeBar} style={{ width: `${Math.abs(r.value) / max * 50}%`, left: r.value >= 0 ? "50%" : `${50 - Math.abs(r.value) / max * 50}%` }} /></div>
  </div>)}</div> : <p className={styles.muted}>{lang === "zh" ? "暂无对齐数据" : "No aligned data available"}</p>;
}
export function NarrativePending({ lang }: { lang: V2Language }) {
  return <div className={styles.narratives} aria-live="polite"><Panel title={lang === "zh" ? "AI 研究" : "AI STUDY"}><p>{lang === "zh" ? "正在生成分析，市场数据可先查看。" : "Preparing analysis. Market data is ready to explore."}</p><div className={styles.skeleton} /></Panel><Panel title={lang === "zh" ? "每日复盘" : "DAILY REVIEW"}><p>{lang === "zh" ? "正在准备复盘…" : "Preparing review…"}</p></Panel></div>;
}
export async function NarrativeRail({ promise, lang }: { promise: Promise<V2HomeNarratives>; lang: V2Language }) {
  const { aiStudy: ai, dailyReview: review } = await promise;
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  return <div className={styles.narratives}>
    <Panel title={t("AI STUDY", "AI 研究")} id="ai-study" note={label(ai.confidence, lang)}>
      <h3 className={styles.aiHeadline}>{ai.regime || t("Market interpretation", "市场解读")}</h3>
      <p>{ai.baseCase || t("Analysis unavailable. Market data remains available.", "分析暂不可用，可继续查看市场数据。")}</p>
      <h4>{t("KEY THINGS TO WATCH", "重点关注")}</h4><p>{ai.whatMattersNext || "—"}</p>
      <h4>{t("IF / THEN", "条件与情景")}</h4><p>{ai.ifThen || "—"}</p>
      <h4>{t("INVALIDATION", "失效条件")}</h4><p>{ai.invalidation || "—"}</p>
      <details className={styles.details}><summary>{t("Read full analysis", "展开完整分析")}</summary>
        {[[t("What changed", "发生了什么变化"), ai.whatChanged], [t("Tension", "信号分歧"), ai.tension], [t("Hidden risk", "潜在风险"), ai.hiddenRisk], [t("Reaction quality", "市场反应"), ai.reactionQuality], [t("Cross-asset conflict", "跨资产分歧"), ai.crossAssetConflict]].map(([title, value]) => <div key={title}><h4>{title}</h4><p>{value || "—"}</p></div>)}
        <ul>{ai.dataLimitations.map((line, i) => <li key={i}>{line}</li>)}</ul>
      </details>
    </Panel>
    <Panel title={t("DAILY REVIEW", "每日复盘")} id="daily-review">
      <h3>{t("Outcome", "实际结果")}</h3><p>{review.actualOutcome || t("Pending close validation", "等待收盘验证")}</p>
      <h4>{t("WHAT WORKED", "有效部分")}</h4><ul>{review.whatWorked.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <h4>{t("WHAT FAILED", "失效部分")}</h4><ul>{review.whatFailed.map((line, i) => <li key={i}>{line}</li>)}</ul>
      {review.errorExplanation && <p>{review.errorExplanation}</p>}
      <h4>{t("NEXT SESSION", "下一交易日")}</h4><ul>{review.tomorrowWatch.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <details className={styles.details}><summary>{t("Review limitations", "复盘数据限制")}</summary><ul>{review.dataLimitations.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
    </Panel>
  </div>;
}
export function DarkCommandCenter({ view, lang, demoMode = false, narratives, source, forceFixture = false }: {
  view: V2CommandCenterPageView; lang: V2Language; demoMode?: boolean; narratives?: Promise<V2HomeNarratives>; source?: string; forceFixture?: boolean;
}) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const home = demoMode ? "/demo" : "/";
  const languageHref = (next: string) => { const q = new URLSearchParams({ lang: next }); if (source) q.set("source", source); if (forceFixture) q.set("gamma", "fixture"); return `${home}?${q}`; };
  const state = view.decisionStatus === "ready" || demoMode ? label(view.stance, lang) : t("Awaiting inputs", "等待数据");
  const rotation = [...view.sectorRotation.sectors].sort((a, b) => b.return1d - a.return1d);
  const feed = view.catalystFeed;
  const news = feed ? selectNewsFeedCatalysts(feed.catalysts, { now: new Date() }) : [];
  const status = resolveAiStudyMarketStatus(new Date());
  const marketLabel = status === "regular_session_open" ? t("Market Open", "交易时段") : status === "premarket" ? t("Premarket", "盘前") : t("Market Closed", "已收盘");
  return <div data-testid="market-workspace" className={styles.app} lang={lang === "zh" ? "zh-CN" : "en"}>
    <div className={styles.tape}>{["SPY", "QQQ", "BTC/USD", "GLD", "USO", "UUP"].map(symbol => {
      const q = view.marketQuotes.find(row => row.symbol === symbol);
      return <span key={symbol}><b>{symbol}</b> {number(q?.latestPrice, 2)} <em className={q?.dailyChangePct == null ? "" : tone(q.dailyChangePct)}>{signed(q?.dailyChangePct, 2)}</em></span>;
    })}<span className={styles.marketStatus}>{marketLabel}</span></div>
    <header className={styles.nav}><a className={styles.logo} href={home}>Gamma<span>Desk</span></a>
      <nav aria-label={t("Sections", "页面导航")}>{[["overview", t("Overview", "总览")], ["structure", t("Structure", "市场结构")], ["rotation", t("Rotation", "板块轮动")], ["macro", t("Macro", "宏观")], ["ai-study", t("AI Study", "AI 研究")], ["daily-review", t("Review", "复盘")]].map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}</nav>
      <div className={styles.languages}><a href={languageHref("en")} aria-current={lang === "en" ? "page" : undefined}>EN</a><span>/</span><a href={languageHref("zh")} aria-current={lang === "zh" ? "page" : undefined}>中文</a></div>
    </header>
    {demoMode && <div className={styles.notice}>{t("Illustrative methodology preview — not live market data", "方法演示：示意数据，并非实时行情")}</div>}
    <main className={styles.layout}><div className={styles.center}>
      <section className={styles.overview} id="overview">
        <MarketConsider view={view} lang={lang} />
        <div className={styles.sectionHeading}><span>01</span><h2>{t("Decision overview", "决策总览")}</h2><small>{t("The numbers behind the view", "判断背后的关键指标")}</small></div>
        <OverviewCards view={view} lang={lang} />
      </section>
      <div className={styles.sectionHeading} id="structure"><span>02</span><h2>{t("Market structure", "市场结构")}</h2><small>{t("Positioning, price levels & participation", "持仓结构、价格关键位与市场参与度")}</small></div>
      {!demoMode && <HomeManualGammaInput view={view} lang={lang} />}
      <div className={styles.twoColumns}>{view.gamma.map(g => <LevelCard key={g.symbol} g={g} lang={lang} cone={view.gammaCone.find(item => item.symbol === g.symbol)} />)}</div>
      <div className={styles.twoColumns}>
        <Panel title={t("Market Breadth", "市场宽度")}><Breadth data={view.spyBreadth} symbol="SPY" lang={lang} /></Panel>
        <Panel title={t("Sector Performance (1D)", "板块表现（1日）")} note={view.sectorRotation.sessionDate ?? "—"}><Bars rows={rotation.map(r => ({ symbol: r.symbol, value: r.return1d }))} lang={lang} /></Panel>
      </div>
      <div className={styles.sectionHeading} id="rotation"><span>03</span><h2>{t("Rotation & participation", "轮动与市场参与度")}</h2><small>{t("Relative performance, not reported fund flows", "相对表现，不代表已确认资金流向")}</small></div>
      <div className={styles.twoColumns}>
        <Panel title={t("Sector Rotation", "板块轮动")} note={t("5D vs SPY · percentage points", "5日相对 SPY · 百分点")}><Bars rows={[...view.sectorRotation.sectors].sort((a, b) => b.rs5d - a.rs5d).map(r => ({ symbol: r.symbol, value: r.rs5d }))} lang={lang} /><p className={styles.meta}>{view.sectorRotation.sessionDate ?? "—"} · {view.sectorRotation.stale ? t("Stale", "已过期") : label(view.sectorRotation.status, lang)}</p></Panel>
        <Panel title={t("Technology Internal", "科技内部轮动")} note={t("5D vs XLK · percentage points", "5日相对 XLK · 百分点")}><Bars rows={view.technologyInternal.rows.map(r => ({ symbol: r.symbol, value: r.rs5dVsXlk }))} lang={lang} /><p className={styles.meta}>{view.technologyInternal.sessionDate ?? "—"} · {label(view.technologyInternal.status, lang)}</p></Panel>
      </div>
      <div className={styles.twoColumns}><Panel title={t("Nasdaq Participation", "纳斯达克参与度")}><Breadth data={view.qqqBreadth} symbol="QQQ" lang={lang} /></Panel>
        <Panel title={t("Technology Leaders & Laggards", "科技领涨与领跌")} note={view.techLeadersLaggards.sessionDate ?? "—"}><Bars rows={[...view.techLeadersLaggards.leaders, ...view.techLeadersLaggards.laggards].map(r => ({ symbol: r.symbol, value: r.return1dPct }))} lang={lang} /></Panel></div>
      <div className={styles.sectionHeading} id="macro"><span>04</span><h2>{t("Macro & risk context", "宏观与风险背景")}</h2></div>
      <div className={styles.twoColumns}><Panel title={t("Macro Drivers", "宏观驱动")} note={view.macroSummary?.marketSessionDate ?? "—"}><h3>{view.macroSummary?.label ?? "—"}</h3><p>{view.macroSummary?.interpretation ?? t("No aligned macro snapshot.", "暂无对齐的宏观快照。")}</p><ul>{view.macroSummary?.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul></Panel>
        <Panel title={t("Risk & Allocation", "风险与配置")}><dl className={styles.rows}>
          <div><dt>{t("SPY structural risk", "SPY 结构风险")}</dt><dd>{number(view.spyStructuralRiskScore)}</dd></div><div><dt>{t("QQQ structural risk", "QQQ 结构风险")}</dt><dd>{number(view.qqqStructuralRiskScore)}</dd></div>
          <div><dt>{t("Risk change", "风险变化")}</dt><dd>{number(view.riskChange)}</dd></div>
          {([["highBeta", t("High Beta", "高弹性")], ["defense", t("Defense", "防御")], ["metals", t("Metals", "金属")], ["hedge", t("Hedge", "对冲")]] as const).map(([key, name]) => <div key={key}><dt>{name}</dt><dd>{number(view.allocation?.[key])}{view.allocation ? "%" : ""}</dd></div>)}
        </dl><p className={styles.meta}>{view.riskChangeReason}</p></Panel></div>
      <Panel title={t("Decision Evidence & Data Coverage", "决策依据与数据覆盖")}><ul>{view.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul>
        {view.missingInputs.length > 0 && <details className={styles.details}><summary>{t("Unavailable inputs", "缺失数据")} ({view.missingInputs.length})</summary><ul>{view.missingInputs.map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
      </Panel>
      <div className={styles.sectionHeading}><span>05</span><h2>{t("News & events", "新闻与事件")}</h2><small>{t("The latest context to monitor", "需要跟踪的新变化")}</small></div>
      <Panel title={t("News & Market Events", "新闻与市场事件")} note={feed?.generatedAt ?? "—"} id="news">
        {news.length ? <ul className={styles.news}>{news.map(item => <li key={item.id}><time>{item.occurredAt.replace("T", " ").slice(0, 16)} UTC</time><span>{item.headline}</span><small>{label(item.importance, lang)}</small></li>)}</ul> : <p>{feed ? t("No events in the selected window.", "所选时间窗口内暂无事件。") : t("Event feed unavailable.", "事件数据暂不可用。")}</p>}
      </Panel>
    </div><aside className={styles.rail}><Suspense fallback={<NarrativePending lang={lang} />}><NarrativeRail promise={narratives ?? Promise.resolve({ aiStudy: view.aiStudy, dailyReview: view.dailyReview })} lang={lang} /></Suspense></aside></main>
    <footer className={styles.footer}><b>GammaDesk</b><span>{t("Options flow. Market structure. Clearer decisions.", "期权结构 · 市场研究 · 清晰决策")}</span><small>{t("Market data for information only. Not investment advice.", "市场信息仅供参考，不构成投资建议。")}</small></footer>
  </div>;
}
