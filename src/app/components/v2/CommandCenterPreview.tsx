import type { CSSProperties } from "react";
import type { V2CommandCenterPageView } from "@/desk/load-v2-home";
import type { V2Language } from "@/desk";

const BLUE = "#004fff";

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function signed(n: number | null | undefined, suffix = "") {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmt(n, 1)}${suffix}`;
}

function highBetaAction(view: V2CommandCenterPageView) {
  const current = view.allocation?.highBeta;
  if (current == null) return "—";
  if (view.riskChange == null || Math.abs(view.riskChange) <= 2) return "HOLD";
  return view.riskChange > 0 ? "TRIM" : "ADD";
}

function confidencePct(level: V2CommandCenterPageView["aiStudy"]["confidence"]) {
  if (level === "high") return 82;
  if (level === "moderate") return 58;
  return 35;
}

function riskTone(score: number | null) {
  if (score == null) return "neutral";
  if (score <= 40) return "good";
  if (score <= 65) return "neutral";
  return "bad";
}

function coneFor(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  return view.gammaCone.find((item) => item.symbol === symbol);
}

function gammaFor(view: V2CommandCenterPageView, symbol: "SPY" | "QQQ") {
  return view.gamma.find((item) => item.symbol === symbol);
}

function bandText(band: { lower: number; upper: number } | null | undefined) {
  if (!band) return "—";
  return `${fmt(band.lower, band.lower >= 100 ? 0 : 1)}–${fmt(band.upper, band.upper >= 100 ? 0 : 1)}`;
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

function StructureCard({ view, symbol }: { view: V2CommandCenterPageView; symbol: "SPY" | "QQQ" }) {
  const g = gammaFor(view, symbol);
  const cone = coneFor(view, symbol);
  if (!g) return null;
  const activeCone = cone?.restOfDay.status === "available" ? cone.restOfDay : cone?.fullSession;
  const core = activeCone?.coreRange50 ?? null;
  const expected = activeCone?.expectedRange90 ?? null;
  const values = [g.callWall, g.spot, g.gammaFlip, g.putWall, expected?.lower, expected?.upper, core?.lower, core?.upper]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const expectedLeft = expected ? levelPct(expected.lower, values) : 0;
  const expectedWidth = expected ? levelPct(expected.upper, values) - expectedLeft : 0;
  const coreLeft = core ? levelPct(core.lower, values) : 0;
  const coreWidth = core ? levelPct(core.upper, values) - coreLeft : 0;
  const rows = [
    ["CALL WALL", g.callWall, "#149447"],
    ["SPOT", g.spot, "#15254a"],
    ["GAMMA FLIP", g.gammaFlip, BLUE],
    ["PUT WALL", g.putWall, "#ff2d2d"],
  ] as const;

  return <article className="pv-structure-card">
    <div className="pv-symbol-head">
      <div><strong>{symbol}</strong><span>{symbol === "SPY" ? "SPDR S&P 500 ETF" : "Invesco QQQ Trust"}</span></div>
      <div className="pv-regime">{g.dealerFlowRegime?.includes("Stabilizing") ? "STABILIZING" : (g.regime ?? "STRUCTURE")}</div>
    </div>
    <div className="pv-price">{fmt(g.spot, 2)} <span className="good">{g.freshness === "stale" ? "STALE" : ""}</span></div>
    <div className="pv-structure-grid">
      <div className="pv-level-labels">
        {rows.map(([label, value, color]) => <div key={label}><i style={{background: color}}/><span>{label}</span><strong>{fmt(value, value != null && value % 1 ? 2 : 0)}</strong></div>)}
      </div>
      <div className="pv-chart">
        {expected && <div className="pv-band expected" style={{left:`${expectedLeft}%`,width:`${Math.max(expectedWidth,1)}%`}}/>}
        {core && <div className="pv-band core" style={{left:`${coreLeft}%`,width:`${Math.max(coreWidth,1)}%`}}/>}
        {rows.map(([label, value, color]) => value != null ? <div className="pv-axis" key={label} style={{top: `${12 + rows.findIndex(r=>r[0]===label)*24}%`, borderColor: color}}><span className="pv-dot" style={{left:`${levelPct(value,values)}%`, background:color}}/></div> : null)}
      </div>
    </div>
    <div className="pv-cone-legend">
      <span><b className="swatch expected"/>90% Expected Range <strong>{bandText(expected)}</strong></span>
      <span><b className="swatch core"/>50% Core Range <strong>{bandText(core)}</strong></span>
    </div>
    <div className="pv-touch-row">
      <span>Call Wall Touch <strong className="good">{g.callWallTouch.percent == null ? "—" : `${g.callWallTouch.percent}%`}</strong></span>
      <span>Put Wall Touch <strong className="bad">{g.putWallTouch.percent == null ? "—" : `${g.putWallTouch.percent}%`}</strong></span>
      <span>Dealer Flow <strong>{g.dealerFlowRegime?.includes("Stabilizing") ? "Supportive" : g.regime ?? "—"}</strong></span>
    </div>
  </article>;
}

function FlowSection({ view }: { view: V2CommandCenterPageView }) {
  const rows = [
    ["SPY Breadth (Adv/Dec)", view.spyBreadth.advancingPct == null ? "—" : `${fmt(view.spyBreadth.advancingPct)}%`, view.spyBreadth.breadthSignal ?? "—"],
    ["QQQ Breadth (Adv/Dec)", view.qqqBreadth.advancingPct == null ? "—" : `${fmt(view.qqqBreadth.advancingPct)}%`, view.qqqBreadth.breadthSignal ?? "—"],
    ["CTA Proxy", view.ctaProxy.signal ?? "—", ""],
    ["IV - HV (SPY)", signed(gammaFor(view,"SPY")?.volMispricing.spreadVolPts, ""), gammaFor(view,"SPY")?.volMispricing.signal ?? ""],
    ["IV - HV (QQQ)", signed(gammaFor(view,"QQQ")?.volMispricing.spreadVolPts, ""), gammaFor(view,"QQQ")?.volMispricing.signal ?? ""],
    ["Net Gamma (SPY)", gammaFor(view,"SPY")?.netGex == null ? "—" : `${(gammaFor(view,"SPY")!.netGex!/1e9).toFixed(1)}B`, gammaFor(view,"SPY")?.regime ?? ""],
    ["Net Gamma (QQQ)", gammaFor(view,"QQQ")?.netGex == null ? "—" : `${(gammaFor(view,"QQQ")!.netGex!/1e9).toFixed(1)}B`, gammaFor(view,"QQQ")?.regime ?? ""],
  ];
  return <section className="pv-flat pv-flow"><h3>FLOW / PARTICIPATION</h3>{rows.map(([a,b,c])=><div className="pv-metric-row" key={a}><span>{a}</span><strong>{b}</strong><em>{c}</em></div>)}</section>;
}

function RotationSection({ view }: { view: V2CommandCenterPageView }) {
  const sectors = [...view.sectorRotation.sectors].sort((a,b)=>b.rs5d-a.rs5d).slice(0,8);
  return <section className="pv-flat pv-rotation"><h3>SECTOR ROTATION <small>(vs SPY)</small></h3>{sectors.map(r=><div className="pv-rotation-row" key={r.symbol}><span>{r.symbol} · {r.symbol}</span><strong className={r.rs5d>=0?"good":"bad"}>{signed(r.rs5d,"%")}</strong><i><b className={r.rs5d>=0?"pos":"neg"} style={{width:`${Math.min(100,Math.abs(r.rs5d)*28+8)}%`}}/></i></div>)}</section>;
}

function AiRail({ view }: { view: V2CommandCenterPageView }) {
  const conf = confidencePct(view.aiStudy.confidence);
  return <aside className="pv-right">
    <section className="pv-ai"><h2>AI STUDY / INSIGHTS</h2><h4>AI VIEW</h4><p>{view.aiStudy.baseCase}</p><h4>KEY LEVELS TO WATCH</h4><ul>{view.gamma.map(g=><li key={g.symbol}><strong>{g.symbol}</strong> Call {fmt(g.callWall)} · Flip {fmt(g.gammaFlip)} · Put {fmt(g.putWall)}</li>)}</ul><h4>BULL CASE</h4><p>{view.aiStudy.ifThen}</p><h4>BEAR CASE</h4><p>{view.aiStudy.invalidation}</p><div className="pv-confidence"><div><strong>CONFIDENCE</strong><span>{view.aiStudy.confidence} ({conf}/100)</span></div><i><b style={{width:`${conf}%`}}/></i></div></section>
    <section className="pv-review"><h2>DAILY REVIEW</h2><div><strong>Morning stance</strong><span>{view.dailyReview.morningStance ?? view.stance ?? "—"}</span></div><div><strong>Actual outcome</strong><span>{view.dailyReview.actualOutcome || "Pending"}</span></div><div><strong>Tomorrow watch</strong><span>{view.dailyReview.tomorrowWatch[0] ?? "Pending"}</span></div></section>
  </aside>;
}

export function CommandCenterPreview({ view, lang: _lang, demoMode = false }: { view: V2CommandCenterPageView; lang: V2Language; demoMode?: boolean }) {
  const stance = (view.stance ?? "hold").toUpperCase();
  const trend = view.riskDivergenceTrend?.toUpperCase() ?? "—";
  const hb = view.allocation?.highBeta;
  const riskToneClass = riskTone(view.riskScore);
  const home = demoMode ? "/demo" : "/";
  return <div className="pv-app">
    <style>{styles}</style>
    <aside className="pv-nav"><a className="pv-logo" href={home}>G</a><nav><a className="active" href="#overview">▦ <span>Overview</span></a><a href="#structure">⌁ <span>Market Structure</span></a><a href="#flow">⌁ <span>Flow / Participation</span></a><a href="#rotation">↻ <span>Rotation</span></a><a href="#ai">✦ <span>AI Study</span></a><a href="#review">□ <span>Daily Review</span></a></nav><a className="pv-settings">⚙ <span>Settings</span></a></aside>
    <div className="pv-shell">
      <header className="pv-top"><strong>GammaDesk</strong><div className="pv-tickers"><span>SPY</span><span>QQQ</span><span>IWM</span><span>DIA</span><span>VIX</span><span>10Y</span><span>WTI</span><span>BTC</span></div><div className="pv-open">● Market Open</div></header>
      <main className="pv-main">
        <div className="pv-center">
          <section id="overview"><h2 className="pv-section-title">OVERVIEW</h2><div className="pv-overview">
            <article><h3>MARKET STANCE</h3><strong className="pv-hero">{stance}</strong><p>{view.macroSummary?.interpretation ?? view.macroLabel ?? "Markets direction, not price, confirms the next move."}</p></article>
            <article><h3>SENTIMENT / RISK</h3><div className={`pv-gauge ${riskToneClass}`}><div className="arc"/><b>{view.riskScore ?? "—"}</b></div><p className="center">Neutral / Moderate</p></article>
            <article><h3>RISK SNAPSHOT</h3><div className="pv-snapshot"><span>QQQ vs SPY Spread</span><strong>{formatRiskDivergenceValue(view.riskDivergence)}</strong><b className={view.riskDivergenceTrend === "widening" ? "bad" : "good"}>{trend}</b><small>High Beta: <em>{highBetaAction(view)}</em>{hb == null ? "" : ` · Target ${hb}%`}</small></div></article>
            <article><h3>RECOMMENDED EXPOSURE</h3><strong className="pv-hero">{view.exposure ? `${view.exposure.min}–${view.exposure.max}%` : "—"}</strong><p className="center">of max risk</p><div className="pv-exposure"><b style={{width:`${view.exposure ? (view.exposure.min+view.exposure.max)/3 : 0}%`}}/></div></article>
            <article><h3>KEY DRIVERS</h3><ul className="pv-drivers">{view.evidence.slice(0,4).map((x,i)=><li key={x} className={i>1?"bad":"good"}>{i>1?"↓":"↑"} <span>{x}</span></li>)}</ul><div className="pv-mini-confidence">Confidence <i><b style={{width:"58%"}}/></i></div></article>
          </div></section>

          <section id="structure" className="pv-structure"><h2 className="pv-section-title">MARKET STRUCTURE <small>(OPTION LEVELS)</small></h2><div className="pv-structure-cards"><StructureCard view={view} symbol="SPY"/><StructureCard view={view} symbol="QQQ"/></div></section>
          <div className="pv-bottom-row"><div id="flow"><FlowSection view={view}/></div><div id="rotation"><RotationSection view={view}/></div><section className="pv-flat pv-tech"><h3>TECHNOLOGY INTERNAL <small>(vs XLK)</small></h3><p className="pv-muted">Awaiting dedicated technology-internal series.</p><div className="pv-tech-status">Tech Strength: <strong>—</strong></div></section></div>
        </div>
        <div id="ai"><AiRail view={view}/></div>
      </main>
    </div>
  </div>;
}

function formatRiskDivergenceValue(value: number | null) { if (value == null) return "—"; return `${value > 0 ? "+" : ""}${value}`; }

const styles = `
:root{--pv-blue:#004fff;--pv-text:#10214a;--pv-muted:#65728d;--pv-line:#dce6f3;--pv-good:#0a963f;--pv-bad:#ff2e2e;--pv-bg:#fff}
*{box-sizing:border-box}.pv-app{min-height:100vh;background:#fff;color:var(--pv-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;grid-template-columns:112px 1fr;font-size:12px}.pv-nav{border-right:1px solid var(--pv-line);padding:14px 10px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;background:#fff}.pv-logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#7b61ff,#004fff);display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;text-decoration:none;margin:0 auto 22px}.pv-nav nav{display:grid;gap:8px}.pv-nav nav a,.pv-settings{display:flex;gap:9px;align-items:center;color:#18305e;text-decoration:none;padding:10px 9px;border-radius:8px;font-weight:650}.pv-nav nav a.active{background:#eef4ff;color:var(--pv-blue)}.pv-settings{margin-top:auto}.pv-shell{min-width:0}.pv-top{height:48px;border-bottom:1px solid var(--pv-line);display:grid;grid-template-columns:160px 1fr 120px;align-items:center;padding:0 16px;position:sticky;top:0;background:#fff;z-index:8}.pv-top>strong{font-size:18px}.pv-tickers{display:flex;justify-content:space-around;font-weight:700;color:#1d3565}.pv-open{color:#153257;font-weight:700}.pv-open:first-letter{color:var(--pv-good)}.pv-main{display:grid;grid-template-columns:minmax(760px,1fr) 320px;gap:12px;padding:12px}.pv-center{min-width:0}.pv-section-title{font-size:15px;color:var(--pv-blue);margin:0 0 8px;font-weight:800}.pv-section-title small{font-size:10px}.pv-overview{display:grid;grid-template-columns:1.05fr .95fr .95fr 1fr 1.1fr;gap:8px}.pv-overview>article{border:1px solid var(--pv-line);border-radius:8px;min-height:170px;padding:14px 14px 12px;background:#fff}.pv-overview h3,.pv-flat h3{font-size:11px;margin:0 0 16px;font-weight:800}.pv-hero{display:block;color:var(--pv-blue);font-size:30px;line-height:1.05;margin:24px 0 12px;text-align:center}.pv-overview p{font-size:11px;line-height:1.5;color:#25365c}.pv-overview p.center{text-align:center}.pv-gauge{position:relative;height:88px;width:150px;margin:8px auto 0;overflow:hidden}.pv-gauge .arc{width:140px;height:140px;border:14px solid #e8edf5;border-bottom-color:transparent;border-left-color:#ff4242;border-top-color:#ffb11b;border-right-color:#1da358;border-radius:50%;transform:rotate(-45deg);margin:8px auto}.pv-gauge b{position:absolute;left:0;right:0;bottom:2px;text-align:center;font-size:28px}.pv-snapshot{text-align:center;display:grid;gap:8px}.pv-snapshot>span{font-weight:700}.pv-snapshot>strong{font-size:30px;color:var(--pv-bad);margin-top:8px}.pv-snapshot>b{font-style:normal}.pv-snapshot small{border-top:1px solid var(--pv-line);padding-top:10px}.pv-snapshot em{font-style:normal;color:var(--pv-bad);font-weight:800}.pv-exposure{height:7px;border-radius:99px;background:#e8edf4;overflow:hidden;margin:22px 4px 0}.pv-exposure b{display:block;height:100%;background:var(--pv-good)}.pv-drivers{list-style:none;margin:0;padding:0;display:grid;gap:9px;font-size:10px}.pv-drivers li{font-weight:800;display:flex;gap:5px}.pv-drivers li span{color:#22345a;font-weight:600}.good{color:var(--pv-good)!important}.bad{color:var(--pv-bad)!important}.pv-mini-confidence{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:10px}.pv-mini-confidence i{height:5px;flex:1;background:#e8edf4;border-radius:99px;overflow:hidden}.pv-mini-confidence b{display:block;height:100%;background:var(--pv-blue)}.pv-structure{margin-top:10px;border:1px solid var(--pv-line);border-radius:8px;padding:10px}.pv-structure-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pv-structure-card{min-width:0;padding:8px 10px;border-right:1px solid var(--pv-line)}.pv-structure-card:last-child{border-right:0}.pv-symbol-head{display:flex;justify-content:space-between;align-items:center}.pv-symbol-head>div:first-child{display:flex;gap:12px;align-items:baseline}.pv-symbol-head strong{font-size:22px}.pv-symbol-head span{font-size:10px;color:var(--pv-muted)}.pv-regime{font-size:10px;background:#edf4ff;color:var(--pv-blue);padding:5px 10px;border-radius:5px;font-weight:800}.pv-price{font-size:21px;font-weight:800;margin:8px 0}.pv-structure-grid{display:grid;grid-template-columns:125px 1fr;gap:8px;min-height:120px}.pv-level-labels{display:grid;grid-template-rows:repeat(4,1fr)}.pv-level-labels>div{display:grid;grid-template-columns:8px 1fr auto;align-items:center;gap:6px;font-size:10px}.pv-level-labels i{width:6px;height:6px;border-radius:50%}.pv-chart{position:relative;border-bottom:1px solid #d6e0ef;overflow:hidden}.pv-axis{position:absolute;left:0;right:0;border-top:1px solid}.pv-dot{position:absolute;width:8px;height:8px;border-radius:50%;top:-4px;transform:translateX(-50%)}.pv-band{position:absolute;top:8%;bottom:8%;border-radius:2px;z-index:0}.pv-band.expected{background:rgba(55,126,255,.10)}.pv-band.core{background:rgba(55,126,255,.20)}.pv-cone-legend{display:flex;gap:20px;border-top:1px solid #edf1f7;margin-top:6px;padding:8px 4px 4px;font-size:9px}.pv-cone-legend span{display:flex;gap:6px;align-items:center}.swatch{width:14px;height:10px;display:inline-block;border:1px solid #c8d8f3}.swatch.expected{background:rgba(55,126,255,.10)}.swatch.core{background:rgba(55,126,255,.25)}.pv-touch-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #edf1f7;margin-top:4px;padding-top:8px;font-size:9px}.pv-touch-row span{text-align:center;border-right:1px solid #edf1f7}.pv-touch-row span:last-child{border-right:0}.pv-bottom-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}.pv-flat{height:210px;border:1px solid var(--pv-line);border-radius:8px;padding:10px;background:#fff;overflow:hidden}.pv-flat h3{color:var(--pv-blue);font-size:12px;margin-bottom:10px}.pv-flat h3 small{font-size:9px}.pv-metric-row{display:grid;grid-template-columns:1.35fr .55fr .7fr;gap:5px;align-items:center;padding:4px 0;font-size:9px}.pv-metric-row em{font-style:normal;color:var(--pv-muted);text-align:right}.pv-rotation-row{display:grid;grid-template-columns:1.25fr .45fr .8fr;gap:5px;align-items:center;padding:4px 0;font-size:9px}.pv-rotation-row i{height:5px;background:#edf1f6;border-radius:9px;overflow:hidden}.pv-rotation-row b{display:block;height:100%}.pv-rotation-row b.pos{background:#0a963f}.pv-rotation-row b.neg{background:#ff2e2e}.pv-muted{color:var(--pv-muted);font-size:10px;margin-top:24px}.pv-tech-status{border-top:1px solid var(--pv-line);margin-top:80px;padding-top:10px;font-size:10px}.pv-right{background:#f8fbff;border-left:1px solid #e2ebf7;min-height:calc(100vh - 72px);padding:10px;display:grid;grid-template-rows:auto auto;align-content:start;gap:10px}.pv-ai,.pv-review{background:#fff;border:1px solid var(--pv-line);border-radius:8px;padding:14px}.pv-ai h2,.pv-review h2{color:var(--pv-blue);font-size:15px;margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid #e5edf8}.pv-ai h4{font-size:10px;color:var(--pv-blue);margin:14px 0 6px}.pv-ai p,.pv-ai li{font-size:10px;line-height:1.55;color:#27385c}.pv-ai ul{padding-left:16px}.pv-confidence{border-top:1px solid #e5edf8;margin-top:14px;padding-top:10px}.pv-confidence>div{display:flex;justify-content:space-between;font-size:10px}.pv-confidence i{display:block;height:6px;background:#e8edf4;border-radius:99px;margin-top:8px;overflow:hidden}.pv-confidence b{display:block;height:100%;background:var(--pv-blue)}.pv-review>div{display:grid;grid-template-columns:1fr;gap:3px;padding:10px 0;border-bottom:1px solid #edf1f7;font-size:10px}.pv-review span{color:var(--pv-muted)}
@media(max-width:1180px){.pv-app{grid-template-columns:72px 1fr}.pv-nav span{display:none}.pv-main{grid-template-columns:1fr}.pv-right{display:none}.pv-overview{grid-template-columns:repeat(3,1fr)}.pv-bottom-row{grid-template-columns:1fr 1fr}.pv-tickers span:nth-child(n+5){display:none}}
`;
