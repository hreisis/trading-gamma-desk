"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { V2CommandCenterPageView } from "@/desk/load-v2-home";
import type { V2Language } from "@/desk";

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

function factorSignal(view: V2CommandCenterPageView, id: string) {
  const spy = gammaFor(view, "SPY");
  if (id === "breadth") return view.spyBreadth.breadthSignal ?? "—";
  if (id === "gamma") return spy?.regime?.replaceAll("_", " ") ?? "—";
  if (id === "cta") return view.ctaProxy.signal ?? "—";
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
  if (id === "cta" && value.includes("selling")) return "bad";
  if (id === "cta" && value.includes("buying")) return "good";
  if (id === "vol" && value.includes("expensive")) return "bad";
  if (id === "vol" && value.includes("underpriced")) return "good";
  if (id === "event_gate" && !value.includes("clear")) return "bad";
  return "neutral";
}

function ManualGammaPanel({
  view,
  onClose,
}: {
  view: V2CommandCenterPageView;
  onClose: () => void;
}) {
  const spy = gammaFor(view, "SPY");
  const qqq = gammaFor(view, "QQQ");
  return (
    <aside className="mk-manual-panel" aria-label="Manual gamma input">
      <div className="mk-manual-head">
        <h3>MANUAL GAMMA INPUT</h3>
        <button type="button" onClick={onClose} aria-label="Close manual gamma input">×</button>
      </div>
      <label className="mk-source">
        <span>Source</span>
        <select defaultValue="GEXTool">
          <option>GEXTool</option>
          <option>Manual</option>
        </select>
      </label>
      <div className="mk-manual-symbols"><b>SPY</b><b>QQQ</b></div>
      {[
        ["Spot", spy?.spot, qqq?.spot],
        ["Net GEX ($B)", spy?.netGex == null ? null : spy.netGex / 1e9, qqq?.netGex == null ? null : qqq.netGex / 1e9],
        ["Gamma Flip", spy?.gammaFlip, qqq?.gammaFlip],
        ["Call Wall", spy?.callWall, qqq?.callWall],
        ["Put Wall", spy?.putWall, qqq?.putWall],
        ["IV30 (%)", null, null],
      ].map(([label, spyValue, qqqValue]) => (
        <label className="mk-manual-row" key={String(label)}>
          <span>{String(label)}</span>
          <input defaultValue={typeof spyValue === "number" ? fmt(spyValue, 2) : ""} />
          <input defaultValue={typeof qqqValue === "number" ? fmt(qqqValue, 2) : ""} />
        </label>
      ))}
      <label className="mk-manual-wide"><span>Price as-of (ET)</span><input type="datetime-local" /></label>
      <label className="mk-manual-wide"><span>OI as-of (OCC)</span><input type="date" /></label>
      <label className="mk-manual-wide"><span>Notes (optional)</span><textarea rows={2} placeholder="e.g. GEXTool snapshot" /></label>
      <div className="mk-manual-actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="primary">Save &amp; Update</button>
      </div>
    </aside>
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

function MarketStructure({ view }: { view: V2CommandCenterPageView }) {
  const g = gammaFor(view, "SPY");
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

  return (
    <section className="mk-card mk-structure">
      <div className="mk-section-head">
        <h2>MARKET STRUCTURE</h2>
        <select defaultValue="SPY"><option>SPY</option></select>
      </div>
      <div className="mk-structure-content">
        <div className="mk-structure-values">
          <span>Dealer Flow (Net GEX)<b className={isNegative ? "bad" : "good"}>{g?.netGex == null ? "—" : `${g.netGex < 0 ? "−" : "+"}$${Math.abs(g.netGex / 1e9).toFixed(2)}B`}</b></span>
          <span>Gamma Flip<b>{fmt(g?.gammaFlip, 1)}</b></span>
          <span>Call Wall<b>{fmt(g?.callWall, 1)}</b></span>
          <span>Put Wall<b>{fmt(g?.putWall, 1)}</b></span>
          <span>Spot<b>{fmt(g?.spot, 1)}</b></span>
        </div>
        <div className="mk-structure-chart">
          <div className="mk-zone-labels"><span className="bad">Negative Gamma</span><span>Zero Gamma</span><span className="good">Positive Gamma</span></div>
          <div className="mk-gamma-bar"><i className="neg"/><i className="pos"/><b className="flip" style={{ left: `${pct(flip)}%` }}/><b className="spot" style={{ left: `${pct(spot)}%` }}/></div>
          <div className="mk-axis-labels"><span>{fmt(min, 0)}</span><span>{fmt((min + max) / 2, 0)}</span><span>{fmt(max, 0)}</span></div>
          <strong className="mk-spot-caption">Spot {fmt(spot, 1)}</strong>
        </div>
      </div>
      <div className="mk-state"><b>Market State: STABILIZING</b><span>Price near zero-gamma. Expect two-way chop unless flip breaks.</span></div>
    </section>
  );
}

function SectorRotation({ view }: { view: V2CommandCenterPageView }) {
  const rows = useMemo(
    () => [...view.sectorRotation.sectors].sort((a, b) => b.rs5d - a.rs5d).slice(0, 10),
    [view.sectorRotation.sectors],
  );
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.rs5d));
  return (
    <section className="mk-card mk-rotation">
      <h2>SECTOR ROTATION <small>(vs SPY)</small></h2>
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
      <div className="mk-rotation-footer"><span className="good">↑ &nbsp; Leading / Improving</span><span className="bad">Weakening &nbsp; ↓</span></div>
    </section>
  );
}

export function MarketDetailPreview({ view, lang }: { view: V2CommandCenterPageView; lang: V2Language }) {
  const [manualOpen, setManualOpen] = useState(true);
  const exposureMid = view.exposure ? Math.round((view.exposure.min + view.exposure.max) / 2) : null;
  const factorOrder = [
    ["breadth", "Breadth"],
    ["gamma", "Gamma"],
    ["cta", "CTA Proxy"],
    ["vol", "Volatility"],
    ["macro", "Macro"],
    ["event_gate", "Event"],
  ] as const;
  const comparisonById = new Map((view.riskSessionComparison?.factors ?? []).map((row) => [row.id, row]));

  return (
    <div className="mk-app">
      <style>{styles}</style>
      <aside className="mk-nav">
        <div className="mk-brand"><strong>GammaDesk</strong><small>Market Structure Copilot</small></div>
        <nav>
          <a className="active" href="#top"><b>01</b><span>Overview</span></a>
          <a href="#structure"><b>02</b><span>Market Structure</span></a>
          <a href="#structure"><b>03</b><span>Index Gamma<br/>(SPY/QQQ)</span></a>
          <a href="#rotation"><b>04</b><span>Sector Rotation</span></a>
          <a href="#ai-study"><b>05</b><span>AI Study</span></a>
          <a href="#daily-review"><b>06</b><span>Daily Review</span></a>
        </nav>
      </aside>

      <div className="mk-shell" id="top">
        <header className="mk-top">
          <a href="/" className="mk-back" aria-label="Back">‹</a>
          <div className="mk-date"><strong>{view.sessionDate ?? "—"}</strong><small>CBOE delayed ~15m</small></div>
          <div className="mk-top-actions"><span>☀ Market Open</span><button type="button" onClick={() => window.location.reload()}>↻ &nbsp; Refresh</button></div>
        </header>

        <main className="mk-main">
          <div className="mk-center">
            <section className="mk-overview-row">
              <article className="mk-card mk-sentiment"><h2>MARKET SENTIMENT</h2><RiskGauge score={view.riskScore} lang={lang}/>{view.riskChange != null ? <small className={view.riskChange <= 0 ? "good" : "bad"}>{view.riskChange <= 0 ? "↓" : "↑"} {Math.abs(view.riskChange)} vs yesterday</small> : null}</article>
              <article className="mk-card mk-exposure"><h2>EXPOSURE</h2><p>Overall Market Exposure</p><strong>{exposureMid == null ? "—" : `${exposureMid}%`}</strong><small>{exposureMid == null ? "Unavailable" : exposureMid === 0 ? "Neutral" : "Recommended"}</small><div className="mk-exposure-bar"><i/><b style={{ left: `${Math.max(0, Math.min(100, (exposureMid ?? 0) / 1.5))}%` }}/></div><div className="mk-exposure-labels"><span>-100%</span><span>0%</span><span>+100%</span></div></article>
            </section>

            <section className="mk-card mk-drivers">
              <div className="mk-section-head"><h2>KEY DRIVER ALLOCATION</h2><small>How today&apos;s factors contribute to risk</small></div>
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

            <div id="structure"><MarketStructure view={view}/></div>
            <div id="rotation"><SectorRotation view={view}/></div>
            <div className="mk-data-line">Data as of {view.sessionDate ?? "—"} &nbsp; • &nbsp; Price ~15 min delayed (CBOE) &nbsp; • &nbsp; Source: Manual (GEXTool)</div>
          </div>

          <aside className="mk-right">
            <section className="mk-ai" id="ai-study">
              <div className="mk-rail-head"><h2>✦ AI STUDY</h2><small>Generated from current inputs</small></div>
              <h3>Key Takeaway</h3><p>{view.aiStudy.baseCase}</p>
              <h3>What to Watch</h3><ul>{view.gamma.slice(0, 2).map((g) => <li key={g.symbol}><b>{g.symbol}</b> · Flip {fmt(g.gammaFlip)} · Call {fmt(g.callWall)} · Put {fmt(g.putWall)}</li>)}</ul>
              <div className="mk-ai-section"><h3>PRIMARY RISKS</h3><p>{view.aiStudy.invalidation}</p></div>
              <div className="mk-ai-section"><h3>OPPORTUNITIES</h3><p>{view.aiStudy.ifThen}</p></div>
            </section>

            <section className="mk-review" id="daily-review">
              <div className="mk-rail-head"><h2>06 &nbsp; DAILY REVIEW</h2><a href="#">View all</a></div>
              <div className="mk-review-row"><time>4:10 PM</time><p>{view.dailyReview.whatWorked[0] ?? "Market structure review pending."}</p><span>Market Structure</span></div>
              <div className="mk-review-row"><time>3:45 PM</time><p>{view.dailyReview.whatFailed[0] ?? "Volatility review pending."}</p><span>Volatility</span></div>
              <div className="mk-review-row"><time>2:30 PM</time><p>{view.dailyReview.tomorrowWatch[0] ?? "Breadth review pending."}</p><span>Breadth</span></div>
              <div className="mk-review-row"><time>9:50 AM</time><p>{view.macroSummary?.label ?? "Macro review pending."}</p><span>Macro</span></div>
            </section>
          </aside>
        </main>
      </div>

      {manualOpen ? <ManualGammaPanel view={view} onClose={() => setManualOpen(false)}/> : <button type="button" className="mk-open-manual" onClick={() => setManualOpen(true)}>Manual Gamma Input</button>}
    </div>
  );
}

const styles = `
:root{--mk-blue:#004fff;--mk-text:#142347;--mk-muted:#6e7890;--mk-line:#dce5f0;--mk-good:#0b9b55;--mk-bad:#ef3e43;--mk-yellow:#e7aa12}
*{box-sizing:border-box}.mk-app{min-height:100vh;background:#fff;color:var(--mk-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:190px 1fr;font-size:12px}.mk-nav{border-right:1px solid var(--mk-line);background:#fff;height:100vh;position:sticky;top:0;z-index:5}.mk-brand{height:92px;padding:18px 20px;border-bottom:1px solid var(--mk-line);display:flex;flex-direction:column;gap:5px}.mk-brand strong{font-size:17px;color:var(--mk-blue)}.mk-brand small{font-size:9px;color:var(--mk-muted)}.mk-nav nav{display:grid;padding-top:7px}.mk-nav a{display:grid;grid-template-columns:30px 1fr;gap:8px;align-items:center;padding:13px 18px;text-decoration:none;color:#243455;border-left:3px solid transparent;font-size:10px}.mk-nav a b{color:#7894c9}.mk-nav a.active{color:var(--mk-blue);background:#f1f6ff;border-left-color:var(--mk-blue);font-weight:700}.mk-nav a.active b{color:var(--mk-blue)}.mk-shell{min-width:0}.mk-top{height:78px;border-bottom:1px solid var(--mk-line);display:grid;grid-template-columns:32px 1fr auto;align-items:center;padding:0 18px;background:#fff}.mk-back{font-size:31px;line-height:1;text-decoration:none;color:var(--mk-blue);font-weight:300}.mk-date{display:flex;flex-direction:column;gap:4px}.mk-date strong{font-size:11px;color:#17243e}.mk-date small{font-size:9px;color:var(--mk-muted)}.mk-top-actions{display:flex;align-items:center;gap:26px}.mk-top-actions span{color:var(--mk-good);font-weight:700}.mk-top-actions button{border:1px solid var(--mk-line);background:#fff;border-radius:6px;padding:9px 15px;font-weight:700;color:#283650}.mk-main{display:grid;grid-template-columns:minmax(700px,1fr) 330px;gap:10px;padding:10px;background:#fff}.mk-center{min-width:0}.mk-card{border:1px solid var(--mk-line);border-radius:8px;background:#fff}.mk-card h2,.mk-right h2{font-size:11px;margin:0;color:var(--mk-blue);font-weight:800}.mk-overview-row{display:grid;grid-template-columns:1fr 1.2fr;gap:0}.mk-overview-row>.mk-card{min-height:260px;border-radius:0}.mk-overview-row>.mk-card:first-child{border-radius:8px 0 0 8px}.mk-overview-row>.mk-card:last-child{border-radius:0 8px 8px 0;border-left:0}.mk-sentiment,.mk-exposure{padding:18px 20px}.mk-risk-wrap{text-align:center;margin-top:15px}.mk-gauge{width:270px;height:150px;margin:0 auto;position:relative;overflow:hidden}.mk-gauge-arc{position:absolute;left:15px;top:11px;width:240px;height:240px;border-radius:50%;background:conic-gradient(from 270deg,#ef4b42 0 42deg,#ff9e21 42deg 88deg,#e7cf39 88deg 127deg,#8fc664 127deg 153deg,#28a65a 153deg 180deg,transparent 180deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 13px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 13px),#000 0)}.mk-gauge-needle{position:absolute;left:50%;bottom:30px;width:76px;height:2px;background:#1c222d;transform-origin:0 50%;transform:rotate(var(--mk-risk-angle));z-index:2}.mk-gauge-pivot{position:absolute;left:calc(50% - 4px);bottom:26px;width:8px;height:8px;border-radius:50%;background:#1c222d;z-index:3}.mk-gauge>b{position:absolute;left:0;right:0;bottom:35px;font-size:31px;color:#111}.mk-gauge .left,.mk-gauge .right{position:absolute;bottom:9px;font-size:8px;color:var(--mk-muted)}.mk-gauge .left{left:15px}.mk-gauge .right{right:15px}.mk-risk-wrap>strong{display:block;color:#d68809;font-size:11px;margin-top:1px}.mk-sentiment>small{display:block;text-align:center;margin-top:6px;font-size:9px;font-weight:700}.mk-exposure{text-align:center}.mk-exposure h2{text-align:left}.mk-exposure>p{font-size:13px;color:#566078;margin:30px 0 10px}.mk-exposure>strong{display:block;font-size:34px;color:#111}.mk-exposure>small{display:block;color:var(--mk-muted);margin-top:5px}.mk-exposure-bar{height:8px;margin:40px 25px 8px;position:relative;border-radius:99px;background:linear-gradient(90deg,#ef5c62 0,#f5c4c8 42%,#f2f4f7 50%,#c3ead4 58%,#2aae67 100%)}.mk-exposure-bar b{position:absolute;top:-4px;width:8px;height:16px;border-radius:6px;background:#333;transform:translateX(-50%)}.mk-exposure-labels{display:flex;justify-content:space-between;margin:0 20px;font-size:9px;font-weight:700}.mk-exposure-labels span:first-child{color:var(--mk-bad)}.mk-exposure-labels span:last-child{color:var(--mk-good)}.mk-drivers{margin-top:10px;padding:14px 18px}.mk-section-head{display:flex;justify-content:space-between;align-items:center}.mk-section-head small{color:var(--mk-muted);font-size:9px}.mk-driver-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin-top:18px}.mk-driver>div{display:grid;grid-template-columns:15px 1fr auto;gap:4px;align-items:center;font-size:9px}.mk-driver>div span{font-weight:900}.mk-driver>div em{font-style:normal;font-weight:700}.mk-driver>i{display:block;height:6px;background:#e8edf3;border-radius:99px;overflow:hidden;margin-top:9px}.mk-driver>i b{display:block;height:100%;background:#aeb8c7}.mk-driver>i b.good{background:var(--mk-good)}.mk-driver>i b.bad{background:var(--mk-bad)}.mk-driver>i b.neutral{background:#aeb8c7}.mk-structure{margin-top:10px;padding:14px 18px}.mk-structure .mk-section-head select{border:1px solid var(--mk-line);background:#fff;border-radius:5px;padding:6px 10px;color:#2d3a57}.mk-structure-content{display:grid;grid-template-columns:250px 1fr;gap:40px;align-items:center;margin-top:15px}.mk-structure-values{display:grid;gap:12px}.mk-structure-values span{display:flex;justify-content:space-between;font-size:10px}.mk-structure-values b{font-size:10px}.mk-structure-chart{padding:0 15px}.mk-zone-labels{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;font-size:8px;font-weight:700;margin-bottom:9px}.mk-gamma-bar{position:relative;height:15px;border-radius:3px;background:#edf1f5}.mk-gamma-bar i{position:absolute;top:0;bottom:0;width:50%}.mk-gamma-bar .neg{left:0;background:linear-gradient(90deg,#ff8c90,#f8d8da)}.mk-gamma-bar .pos{right:0;background:linear-gradient(90deg,#d8efe0,#92d7af)}.mk-gamma-bar b{position:absolute;z-index:2;transform:translateX(-50%)}.mk-gamma-bar .flip{top:-11px;height:36px;border-left:1px dashed #45536b}.mk-gamma-bar .spot{top:-5px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid #151a23}.mk-axis-labels{display:flex;justify-content:space-between;font-size:8px;color:var(--mk-muted);margin-top:8px}.mk-spot-caption{display:block;text-align:center;font-size:9px;margin-top:4px}.mk-state{display:flex;gap:30px;align-items:center;background:#f2f8f4;border-radius:5px;padding:9px 12px;margin-top:14px;font-size:9px}.mk-state b{color:#1f7547}.mk-state span{color:#39475d}.mk-rotation{margin-top:10px;padding:14px 18px}.mk-rotation h2 small{font-size:9px}.mk-rotation-chart{height:150px;border-bottom:1px solid #d9e1eb;display:grid;grid-template-columns:repeat(10,1fr);gap:10px;align-items:end;margin-top:10px;padding:0 10px}.mk-rotation-col{text-align:center;display:grid;grid-template-rows:18px 95px 18px;align-items:end}.mk-rotation-col>b{font-size:8px}.mk-rotation-barspace{height:95px;position:relative;display:flex;align-items:center;justify-content:center}.mk-rotation-barspace:after{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px solid #e8edf2}.mk-rotation-barspace i{width:28px;z-index:1}.mk-rotation-barspace i.positive{background:#63ba8b;align-self:center;transform:translateY(calc(-50% - 1px))}.mk-rotation-barspace i.negative{background:#ef7679;align-self:center;transform:translateY(calc(50% + 1px))}.mk-rotation-col>strong{font-size:9px}.mk-rotation-footer{display:flex;justify-content:space-between;padding:12px 45px 0;font-size:10px;font-weight:700}.mk-data-line{padding:10px 18px;font-size:8px;color:var(--mk-muted);border-top:1px solid #eef2f6}.mk-right{background:#f8fbff;border-left:1px solid #e5edf7;display:grid;grid-template-rows:auto 1fr;align-content:start}.mk-ai,.mk-review{padding:18px;border-bottom:1px solid var(--mk-line)}.mk-rail-head{display:flex;justify-content:space-between;align-items:center}.mk-rail-head small{font-size:8px;color:var(--mk-muted)}.mk-ai h3{font-size:9px;margin:24px 0 7px;color:#203257}.mk-ai p,.mk-ai li{font-size:10px;line-height:1.65;color:#283755}.mk-ai ul{padding-left:17px}.mk-ai-section{border-top:1px solid var(--mk-line);margin:18px -18px 0;padding:3px 18px 0}.mk-review h2{font-size:13px}.mk-review a{font-size:8px;color:var(--mk-blue);text-decoration:none}.mk-review-row{display:grid;grid-template-columns:48px 1fr auto;gap:8px;align-items:start;padding:13px 0;border-bottom:1px solid #e7edf5}.mk-review-row time{font-size:8px}.mk-review-row p{font-size:9px;line-height:1.5;margin:0}.mk-review-row span{font-size:7px;color:var(--mk-blue);background:#edf4ff;padding:4px 6px;border-radius:4px}.mk-manual-panel{position:fixed;left:0;bottom:0;width:235px;background:#fff;border:1px solid var(--mk-line);box-shadow:0 4px 20px rgba(26,45,78,.16);z-index:20;padding:12px 12px 10px}.mk-manual-head{display:flex;justify-content:space-between;align-items:center}.mk-manual-head h3{font-size:9px;margin:0}.mk-manual-head button{border:0;background:transparent;font-size:18px;color:#647087;cursor:pointer}.mk-source{display:grid;gap:5px;margin-top:12px;font-size:8px}.mk-source select,.mk-manual-panel input,.mk-manual-panel textarea{width:100%;border:1px solid #d9e2ee;border-radius:4px;padding:6px;font:inherit;color:inherit;background:#fff}.mk-manual-symbols{display:grid;grid-template-columns:1fr 54px 54px;gap:7px;margin:12px 0 5px;font-size:8px;color:var(--mk-blue)}.mk-manual-symbols b:first-child{grid-column:2}.mk-manual-row{display:grid;grid-template-columns:1fr 54px 54px;gap:7px;align-items:center;margin:5px 0;font-size:8px}.mk-manual-wide{display:grid;gap:5px;margin-top:9px;font-size:8px}.mk-manual-actions{display:grid;grid-template-columns:1fr 1.25fr;gap:8px;margin-top:10px}.mk-manual-actions button{border-radius:4px;padding:8px;font-size:8px;font-weight:700}.mk-manual-actions .secondary{background:#fff;border:1px solid var(--mk-line);color:#25344f}.mk-manual-actions .primary{background:var(--mk-blue);border:1px solid var(--mk-blue);color:#fff}.mk-open-manual{position:fixed;left:12px;bottom:12px;z-index:20;border:0;border-radius:5px;background:var(--mk-blue);color:#fff;padding:8px 10px;font-size:8px;font-weight:700}.good{color:var(--mk-good)!important}.bad{color:var(--mk-bad)!important}.neutral{color:#78849a!important}@media(max-width:1180px){.mk-main{grid-template-columns:1fr}.mk-right{grid-template-columns:1fr 1fr;border-left:0}.mk-driver-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:850px){.mk-app{grid-template-columns:72px 1fr}.mk-brand{padding:18px 10px}.mk-brand strong{font-size:11px}.mk-brand small,.mk-nav a span{display:none}.mk-nav a{grid-template-columns:1fr;text-align:center;padding:12px 6px}.mk-overview-row{grid-template-columns:1fr}.mk-overview-row>.mk-card{border-radius:8px!important;border:1px solid var(--mk-line)!important}.mk-structure-content{grid-template-columns:1fr}.mk-driver-grid{grid-template-columns:repeat(2,1fr)}.mk-right{grid-template-columns:1fr}.mk-rotation-chart{overflow-x:auto}.mk-manual-panel{width:220px}}
`;
