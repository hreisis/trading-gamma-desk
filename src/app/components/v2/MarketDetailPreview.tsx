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

function quoteFor(view: V2CommandCenterPageView, symbol: string) {
  return view.marketQuotes.find((row) => row.symbol === symbol);
}

function riskLabel(score: number | null, lang: V2Language) {
  if (score == null) return lang === "zh" ? "不可用" : "Unavailable";
  if (score <= 40) return lang === "zh" ? "低风险" : "Low Risk";
  if (score <= 65) return lang === "zh" ? "中等风险" : "Moderate";
  return lang === "zh" ? "偏高风险" : "Elevated";
}

function stanceLabel(stance: V2CommandCenterPageView["stance"], lang: V2Language) {
  if (lang === "zh") {
    if (stance === "buy") return "买入";
    if (stance === "reduce") return "减仓";
    return "持有";
  }
  return (stance ?? "hold").toUpperCase();
}

function factorRows(view: V2CommandCenterPageView) {
  const gamma = gammaFor(view, "SPY");
  return [
    { label: "Breadth", value: view.spyBreadth.breadthSignal ?? "—" },
    { label: "Gamma", value: gamma?.regime?.replaceAll("_", " ") ?? "—" },
    { label: "CTA Proxy", value: view.ctaProxy.signal ?? "—" },
    { label: "Volatility", value: gamma?.volMispricing?.signal ?? "—" },
    { label: "Macro", value: view.macroSummary?.label ?? view.macroLabel ?? "—" },
    { label: "Event", value: view.eventGate?.state ?? "—" },
  ];
}

function ManualInput({ view }: { view: V2CommandCenterPageView }) {
  const spy = gammaFor(view, "SPY");
  const qqq = gammaFor(view, "QQQ");
  return (
    <section className="md-card md-manual">
      <div className="md-card-title">
        <h3>MANUAL MARKET INPUT</h3>
        <small>UI shell · save logic will be wired next</small>
      </div>
      <label className="md-source">Source
        <select defaultValue="GEXTool"><option>GEXTool</option><option>Manual</option></select>
      </label>
      <div className="md-form-grid">
        <div className="md-form-symbol"><b>SPY</b><b>QQQ</b></div>
        {[
          ["Spot", spy?.spot, qqq?.spot],
          ["Net GEX ($B)", spy?.netGex == null ? null : spy.netGex / 1_000_000_000, qqq?.netGex == null ? null : qqq.netGex / 1_000_000_000],
          ["Gamma Flip", spy?.gammaFlip, qqq?.gammaFlip],
          ["Call Wall", spy?.callWall, qqq?.callWall],
          ["Put Wall", spy?.putWall, qqq?.putWall],
          ["IV30 (%)", null, null],
        ].map(([label, spyValue, qqqValue]) => (
          <label key={String(label)} className="md-form-row">
            <span>{String(label)}</span>
            <input defaultValue={typeof spyValue === "number" ? fmt(spyValue, 2) : ""} placeholder="—" />
            <input defaultValue={typeof qqqValue === "number" ? fmt(qqqValue, 2) : ""} placeholder="—" />
          </label>
        ))}
      </div>
      <div className="md-date-grid">
        <label>Price as-of (ET)<input type="datetime-local" /></label>
        <label>OI as-of (OCC)<input type="date" /></label>
      </div>
      <label>Notes (optional)<textarea placeholder="e.g. GEXTool snapshot" rows={2} /></label>
      <button type="button" className="md-save">Save Snapshot</button>
      <small className="md-helper">One snapshot per market session · persistence will be wired by Cursor</small>
    </section>
  );
}

function Structure({ view, symbol }: { view: V2CommandCenterPageView; symbol: "SPY" | "QQQ" }) {
  const g = gammaFor(view, symbol);
  const spot = g?.spot;
  const flip = g?.gammaFlip;
  const call = g?.callWall;
  const put = g?.putWall;
  const values = [spot, flip, call, put].filter((v): v is number => typeof v === "number");
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, max - min);
  const pos = (v: number | null | undefined) => v == null ? 50 : Math.max(3, Math.min(97, ((v - (min - span * .35)) / (span * 1.7)) * 100));
  return (
    <section className="md-card md-structure">
      <div className="md-card-title"><h3>MARKET STRUCTURE ({symbol})</h3><b>{g?.regime?.replaceAll("_", " ") ?? "—"}</b></div>
      <div className="md-structure-body">
        <div className="md-levels">
          <span>Dealer Flow (Net GEX)<b>{g?.netGex == null ? "—" : `${fmt(g.netGex / 1_000_000_000, 2)}B`}</b></span>
          <span>Gamma Flip<b>{fmt(flip, 2)}</b></span>
          <span>Call Wall<b>{fmt(call, 2)}</b></span>
          <span>Put Wall<b>{fmt(put, 2)}</b></span>
          <span>Spot<b>{fmt(spot, 2)}</b></span>
        </div>
        <div className="md-axis-wrap">
          <div className="md-axis-labels"><span>Negative Gamma</span><span>Zero Gamma</span><span>Positive Gamma</span></div>
          <div className="md-axis"><i className="neg"/><i className="pos"/><b className="flip" style={{ left: `${pos(flip)}%` }} /><b className="spot" style={{ left: `${pos(spot)}%` }} /></div>
          <div className="md-axis-caption">Spot {fmt(spot, 2)} · Flip {fmt(flip, 2)}</div>
        </div>
      </div>
    </section>
  );
}

export function MarketDetailPreview({ view, lang }: { view: V2CommandCenterPageView; lang: V2Language }) {
  const spy = gammaFor(view, "SPY");
  const qqq = gammaFor(view, "QQQ");
  const spyQuote = quoteFor(view, "SPY");
  const qqqQuote = quoteFor(view, "QQQ");
  const exposureMid = view.exposure ? Math.round((view.exposure.min + view.exposure.max) / 2) : null;

  return (
    <div className="md-app">
      <style>{styles}</style>
      <aside className="md-nav">
        <a className="md-logo" href="/">G</a>
        <strong>GammaDesk</strong>
        <nav>
          <a href="/">01 Overview</a>
          <a className="active" href="/market">02 Market Detail</a>
          <a href="/#structure">03 Market Structure</a>
          <a href="/#rotation">04 Rotation</a>
          <a href="/#ai-study">05 AI Study</a>
          <a href="/#daily-review">06 Daily Review</a>
        </nav>
      </aside>

      <div className="md-shell">
        <header className="md-top">
          <a href="/" className="md-back">← Overview</a>
          <div className="md-top-quotes"><span>SPY <b>{fmt(spyQuote?.latestPrice, 2)}</b> <em>{signed(spyQuote?.dailyChangePct, "%", 2)}</em></span><span>QQQ <b>{fmt(qqqQuote?.latestPrice, 2)}</b> <em>{signed(qqqQuote?.dailyChangePct, "%", 2)}</em></span></div>
          <strong>{view.sessionDate ?? "—"}</strong>
        </header>

        <main className="md-main">
          <div className="md-content">
            <div className="md-title"><div><small>MARKET DETAIL</small><h1>{stanceLabel(view.stance, lang)}</h1></div><p>Deep-dive view for risk, structure and one daily manual Gamma snapshot.</p></div>

            <section className="md-summary">
              <article><h3>SENTIMENT / RISK</h3><div className="md-gauge"><i/><b>{view.riskScore ?? "—"}</b></div><p>{riskLabel(view.riskScore, lang)}</p><small>as of {view.sessionDate ?? "—"}</small></article>
              <article><h3>EXPOSURE</h3><strong>{view.exposure ? `${view.exposure.min}–${view.exposure.max}%` : "—"}</strong><p>{exposureMid == null ? "Unavailable" : `${exposureMid}% midpoint`}</p><div className="md-exposure"><b style={{ width: `${exposureMid ?? 0}%` }} /></div></article>
              <article className="md-factors"><h3>KEY DRIVER ALLOCATION</h3>{factorRows(view).map((row) => <div key={row.label}><span>{row.label}</span><b>{row.value}</b></div>)}</article>
            </section>

            <div className="md-structure-grid"><Structure view={view} symbol="SPY"/><Structure view={view} symbol="QQQ"/></div>
            <ManualInput view={view}/>

            <section className="md-card md-rotation"><div className="md-card-title"><h3>SECTOR ROTATION</h3><small>5D vs SPY</small></div><div className="md-rotation-grid">{view.sectorRotation.rows.slice(0, 8).map((row) => <div key={row.symbol}><span>{row.symbol}</span><b className={row.rs5dVsSpy >= 0 ? "good" : "bad"}>{signed(row.rs5dVsSpy)}</b><i><em className={row.rs5dVsSpy >= 0 ? "goodbar" : "badbar"} style={{ width: `${Math.min(100, Math.max(8, Math.abs(row.rs5dVsSpy) * 16))}%` }}/></i></div>)}</div></section>

            <section className="md-history"><span>Saved snapshots:</span><button>Aug 14</button><button>Aug 15</button><button>Aug 16</button><button className="active">Aug 17 (Latest)</button><a href="#">View all snapshots →</a></section>
          </div>

          <aside className="md-rail">
            <section><h2>AI STUDY / INSIGHTS</h2><h4>KEY TAKEAWAY</h4><p>{view.aiStudy.baseCase}</p><h4>KEY LEVELS TO WATCH</h4><ul><li>SPY Call {fmt(spy?.callWall)} · Flip {fmt(spy?.gammaFlip)} · Put {fmt(spy?.putWall)}</li><li>QQQ Call {fmt(qqq?.callWall)} · Flip {fmt(qqq?.gammaFlip)} · Put {fmt(qqq?.putWall)}</li></ul><h4>BULL CASE</h4><p>{view.aiStudy.ifThen}</p><h4>BEAR CASE</h4><p>{view.aiStudy.invalidation}</p></section>
            <section><h2>DAILY REVIEW</h2><h4>Morning stance</h4><p>{view.dailyReview.morningStance ?? view.stance ?? "—"}</p><h4>Actual outcome</h4><p>{view.dailyReview.actualOutcome || "Pending"}</p><h4>Tomorrow watch</h4><p>{view.dailyReview.tomorrowWatch[0] ?? "Pending"}</p></section>
          </aside>
        </main>
      </div>
    </div>
  );
}

const styles = `
:root{--md-blue:#004fff;--md-text:#10214a;--md-muted:#66738d;--md-line:#dce6f3;--md-good:#0a963f;--md-bad:#ff2e2e}
*{box-sizing:border-box}.md-app{min-height:100vh;background:#fff;color:var(--md-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:150px 1fr;font-size:12px}.md-nav{border-right:1px solid var(--md-line);padding:18px 14px;position:sticky;top:0;height:100vh;background:#fff}.md-logo{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#735cff,#004fff);color:white;text-decoration:none;font-size:18px;font-weight:900;margin-bottom:8px}.md-nav>strong{font-size:15px}.md-nav nav{display:grid;gap:8px;margin-top:30px}.md-nav nav a{padding:10px 8px;border-radius:7px;text-decoration:none;color:#20345d;font-weight:700;font-size:10px}.md-nav nav a.active{background:#edf4ff;color:var(--md-blue)}.md-shell{min-width:0}.md-top{height:52px;border-bottom:1px solid var(--md-line);display:grid;grid-template-columns:140px 1fr 130px;align-items:center;padding:0 18px;position:sticky;top:0;background:#fff;z-index:3}.md-back{color:var(--md-blue);text-decoration:none;font-weight:800}.md-top-quotes{display:flex;justify-content:center;gap:32px;font-size:9px}.md-top-quotes span{display:flex;gap:5px}.md-top-quotes em{font-style:normal;color:var(--md-muted)}.md-main{display:grid;grid-template-columns:minmax(760px,1fr) 320px;gap:10px;padding:10px;background:#fbfdff}.md-content{min-width:0}.md-title{display:flex;justify-content:space-between;align-items:end;padding:6px 2px 9px}.md-title small{font-weight:850;color:var(--md-blue)}.md-title h1{font-size:28px;margin:2px 0 0;color:var(--md-blue)}.md-title p{color:var(--md-muted);font-size:10px;max-width:430px}.md-summary{display:grid;grid-template-columns:.8fr .8fr 1.4fr;gap:8px}.md-summary article,.md-card,.md-rail section{background:#fff;border:1px solid var(--md-line);border-radius:8px;padding:13px}.md-summary h3,.md-card h3{font-size:10px;color:var(--md-blue);margin:0 0 10px}.md-gauge{position:relative;width:132px;height:76px;margin:4px auto 0;overflow:hidden}.md-gauge i{display:block;width:125px;height:125px;border:13px solid #e8edf5;border-left-color:#ff4a4a;border-top-color:#ffb321;border-right-color:#25a95f;border-bottom-color:transparent;border-radius:50%;transform:rotate(-45deg)}.md-gauge b{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:27px}.md-summary article>p,.md-summary article>small{text-align:center;display:block;color:var(--md-muted)}.md-summary article>strong{display:block;font-size:28px;text-align:center;color:var(--md-blue);margin:24px 0 8px}.md-exposure{height:7px;border-radius:99px;background:#e8edf4;overflow:hidden;margin-top:23px}.md-exposure b{display:block;height:100%;background:var(--md-good)}.md-factors>div{display:grid;grid-template-columns:110px 1fr;gap:10px;padding:5px 0;border-bottom:1px solid #edf2f8;font-size:9px}.md-factors>div b{font-weight:700}.md-structure-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.md-card-title{display:flex;justify-content:space-between;align-items:center}.md-card-title h3{margin:0}.md-card-title small,.md-card-title>b{font-size:8px;color:var(--md-muted)}.md-structure-body{display:grid;grid-template-columns:175px 1fr;gap:18px;margin-top:14px}.md-levels{display:grid;gap:8px}.md-levels span{display:flex;justify-content:space-between;font-size:9px}.md-axis-wrap{align-self:center}.md-axis-labels{display:flex;justify-content:space-between;font-size:7px;font-weight:700;margin-bottom:7px}.md-axis{height:13px;position:relative;border-radius:2px;overflow:visible;background:#edf1f6}.md-axis>i{position:absolute;top:0;bottom:0;width:50%}.md-axis .neg{left:0;background:linear-gradient(90deg,#ff9a9a,#ffd6d6)}.md-axis .pos{right:0;background:linear-gradient(90deg,#d8f2e3,#88d9ab)}.md-axis b{position:absolute;top:-5px;transform:translateX(-50%)}.md-axis b.flip{height:24px;border-left:1px dashed #40516f}.md-axis b.spot{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #111;top:16px}.md-axis-caption{text-align:center;margin-top:21px;font-size:8px}.md-manual{margin-top:8px}.md-source{display:grid;grid-template-columns:60px 1fr;gap:8px;align-items:center;margin:12px 0 8px}.md-source select,.md-manual input,.md-manual textarea{border:1px solid #d9e2ef;border-radius:5px;padding:7px;background:#fff;font:inherit;color:inherit}.md-form-grid{display:grid;gap:5px}.md-form-symbol{display:grid;grid-template-columns:1fr 95px 95px;gap:7px}.md-form-symbol b:first-child{grid-column:2}.md-form-row{display:grid;grid-template-columns:1fr 95px 95px;gap:7px;align-items:center;font-size:9px}.md-date-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.md-date-grid label,.md-manual>label{display:grid;gap:5px;font-size:8px;font-weight:700}.md-save{width:100%;margin-top:10px;border:0;border-radius:5px;background:var(--md-blue);color:#fff;font-weight:850;padding:9px;cursor:pointer}.md-helper{display:block;text-align:center;color:var(--md-muted);margin-top:5px;font-size:7px}.md-rotation{margin-top:8px}.md-rotation-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 20px;margin-top:12px}.md-rotation-grid>div{display:grid;grid-template-columns:55px 50px 1fr;gap:7px;align-items:center;font-size:8px}.md-rotation-grid i{height:5px;background:#edf2f7;border-radius:99px;overflow:hidden}.md-rotation-grid em{display:block;height:100%}.good{color:var(--md-good)!important}.bad{color:var(--md-bad)!important}.goodbar{background:var(--md-good)}.badbar{background:var(--md-bad)}.md-history{display:flex;gap:7px;align-items:center;padding:12px 4px;font-size:8px}.md-history button{border:1px solid var(--md-line);background:#fff;padding:5px 8px;border-radius:5px;color:#40516f}.md-history button.active{background:#edf4ff;color:var(--md-blue);border-color:#c8dafc}.md-history a{margin-left:auto;color:var(--md-blue);text-decoration:none;font-weight:800}.md-rail{display:grid;gap:8px;align-content:start}.md-rail section{background:#f8fbff}.md-rail h2{font-size:14px;color:var(--md-blue);margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #e1eaf5}.md-rail h4{font-size:8px;color:var(--md-blue);margin:12px 0 5px}.md-rail p,.md-rail li{font-size:9px;line-height:1.55;color:#2a3b5d}.md-rail ul{padding-left:15px}@media(max-width:1050px){.md-main{grid-template-columns:1fr}.md-rail{grid-template-columns:1fr 1fr}.md-summary{grid-template-columns:1fr 1fr}.md-factors{grid-column:1/-1}}@media(max-width:760px){.md-app{grid-template-columns:72px 1fr}.md-nav>strong,.md-nav nav a{font-size:0}.md-nav nav a::first-letter{font-size:10px}.md-structure-grid,.md-summary,.md-rail{grid-template-columns:1fr}.md-main{padding:7px}.md-structure-body{grid-template-columns:1fr}.md-top{grid-template-columns:80px 1fr}.md-top>strong{display:none}}
`;
