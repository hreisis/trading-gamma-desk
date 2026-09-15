import { loadZeroGex } from "@/desk/zerogex";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import styles from "./DarkCommandCenter.module.css";

export async function ZeroGexPanel({ lang }: { lang: "en" | "zh" }) {
  const zh = lang === "zh";
  const store = resolveRuntimeJsonStore();
  const results = await Promise.all((["SPY", "QQQ"] as const).map(async symbol => ({ symbol, ...await loadZeroGex(symbol, store) })));
  const fmt = (n: number | null) => n === null ? "—" : n.toFixed(2);
  return <section aria-label="ZeroGEX" style={{ borderTop: "1px solid #263b4c", padding: "20px 0" }}>
    <h3>ZeroGEX · {zh ? "外部 Gamma 参考" : "External gamma reference"}</h3>
    <p className={styles.meta}>{zh ? "免费延迟数据 · 刷新页面时获取 · 暂不计入评分" : "Free delayed data · fetched on page refresh · not included in scores"}</p>
    <div className={styles.twoColumns}>{results.map(({ symbol, data, fallback }) => <div key={symbol}>
      <h4>{symbol} · {data ? data.net_gex_at_spot < 0 ? (zh ? "负 Gamma" : "Negative gamma") : data.net_gex_at_spot > 0 ? (zh ? "正 Gamma" : "Positive gamma") : (zh ? "零 Gamma" : "Zero gamma") : "—"}</h4>
      {data ? <>
        <p>GEX {(data.net_gex_at_spot / 1e9).toFixed(2)}B USD · Spot {fmt(data.spot)}</p>
        <p>Flip {fmt(data.gamma_flip)} · Call {fmt(data.call_wall)} · Put {fmt(data.put_wall)}</p>
        <p className={styles.meta}>{zh ? "快照计算时间" : "Snapshot computed"}: {data.as_of} · {data.market_phase}</p>
        {fallback && <p role="status">{zh ? "更新未成功，显示上次快照" : "Refresh unavailable; showing previous snapshot"}</p>}
      </> : <p role="status">{zh ? "暂时无法获取数据" : "Data temporarily unavailable"}</p>}
      <a href={`https://zerogex.io/${symbol.toLowerCase()}-gamma-levels`} target="_blank" rel="noreferrer">{zh ? "来源与详情" : "Source and details"} ↗</a>
    </div>)}</div>
    <p className={styles.meta}>{zh ? "约延迟 15 分钟；闭市保留最近快照。计算时间不等于底层期权更新时间。Gamma 描述波动放大或抑制，不预测方向。" : "Approximately 15-minute delay; latest snapshot outside market hours. Computation time is not the underlying options timestamp. Gamma describes volatility amplification or compression, not direction."}</p>
  </section>;
}
