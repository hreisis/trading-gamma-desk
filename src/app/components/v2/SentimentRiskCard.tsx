"use client";

import type { CSSProperties } from "react";
import type { V2Language } from "@/desk";
import type { RiskSessionComparison } from "@/desk/risk-decision-v1";

function riskLabel(score: number | null, lang: V2Language) {
  if (score == null) return lang === "zh" ? "不可用" : "Unavailable";
  if (score <= 40) return lang === "zh" ? "低 / 支撑" : "Low / Supportive";
  if (score <= 65) return lang === "zh" ? "中性 / 中等" : "Neutral / Moderate";
  return lang === "zh" ? "偏高 / 防御" : "Elevated / Defensive";
}

const linkStyle: CSSProperties = {
  display: "block",
  height: "100%",
  color: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const cueStyle: CSSProperties = {
  color: "#004fff",
  fontSize: 8,
  fontWeight: 800,
  letterSpacing: ".02em",
  whiteSpace: "nowrap",
};

export function SentimentRiskCard({
  riskScore,
  sessionDate,
  comparison: _comparison,
  lang,
}: {
  readonly riskScore: number | null;
  readonly sessionDate: string | null;
  readonly comparison: RiskSessionComparison | null;
  readonly lang: V2Language;
}) {
  return (
    <a
      className="pv-sentiment-link"
      href={`/market?lang=${lang}`}
      aria-label={lang === "zh" ? "打开市场详情" : "Open market detail"}
      style={linkStyle}
    >
      <div className="pv-sentiment-head">
        <h3>SENTIMENT / RISK</h3>
        <span className="pv-market-detail-cue" style={cueStyle}>
          {lang === "zh" ? "市场详情" : "MARKET DETAIL"} →
        </span>
      </div>
      <div className="pv-gauge">
        <div className="arc" />
        <b>{riskScore ?? "—"}</b>
      </div>
      <p className="center">{riskLabel(riskScore, lang)}</p>
      <small className="pv-risk-asof">
        {lang === "zh" ? "数据日期" : "as of"} {sessionDate ?? "—"}
      </small>
    </a>
  );
}
