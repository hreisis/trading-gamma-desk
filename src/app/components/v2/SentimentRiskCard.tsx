"use client";

import { useState } from "react";
import type { V2Language } from "@/desk";
import type { RiskSessionComparison } from "@/desk/risk-decision-v1";

const FACTOR_LABELS: Record<
  string,
  { readonly en: string; readonly zh: string }
> = {
  breadth: { en: "Breadth", zh: "广度" },
  macro: { en: "Macro", zh: "宏观" },
  cta: { en: "CTA", zh: "CTA" },
  vol: { en: "Vol", zh: "波动率" },
  gamma: { en: "Dealer Flow", zh: "做市流量" },
  event_gate: { en: "Event Gate", zh: "事件门" },
};

function riskLabel(score: number | null, lang: V2Language) {
  if (score == null) return lang === "zh" ? "不可用" : "Unavailable";
  if (score <= 40) return lang === "zh" ? "低 / 支撑" : "Low / Supportive";
  if (score <= 65) return lang === "zh" ? "中性 / 中等" : "Neutral / Moderate";
  return lang === "zh" ? "偏高 / 防御" : "Elevated / Defensive";
}

function fmtScore(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

function riskDeltaClass(delta: number | null) {
  if (delta == null || delta === 0) return "neutral";
  return delta < 0 ? "good" : "bad";
}

function riskDeltaLabel(delta: number | null, lang: V2Language) {
  if (delta == null) return "—";
  if (delta === 0) return lang === "zh" ? "0" : "0";
  const arrow = delta < 0 ? "↓" : "↑";
  const suffix = lang === "zh" ? "风险" : " risk";
  return `${arrow}${Math.abs(delta)}${suffix}`;
}

function RiskDetailsTable({
  comparison,
  lang,
}: {
  comparison: RiskSessionComparison;
  lang: V2Language;
}) {
  const rows = [
    ...comparison.factors.map((factor) => ({
      key: factor.id,
      label: FACTOR_LABELS[factor.id]?.[lang === "zh" ? "zh" : "en"] ?? factor.id,
      today: factor.todayScore,
      previous: factor.previousScore,
    })),
    {
      key: "concentration",
      label: lang === "zh" ? "集中度惩罚" : "Concentration penalty",
      today: comparison.todayConcentrationPenalty,
      previous: comparison.previousConcentrationPenalty,
    },
  ];

  return (
    <div className="pv-risk-details">
      <table>
        <tbody>
          {rows.map((row) => {
            const delta =
              row.today != null && row.previous != null
                ? row.today - row.previous
                : null;
            return (
              <tr key={row.key}>
                <td className="pv-risk-factor">{row.label}</td>
                <td className="pv-risk-today">{fmtScore(row.today)}</td>
                <td className="pv-risk-prev">
                  {row.previous == null ? "—" : `← ${fmtScore(row.previous)}`}
                </td>
                <td className={`pv-risk-delta ${riskDeltaClass(delta)}`}>
                  {riskDeltaLabel(delta, lang)}
                </td>
              </tr>
            );
          })}
          <tr className="pv-risk-summary">
            <td className="pv-risk-factor">
              {lang === "zh" ? "风险分数" : "Risk Score"}
            </td>
            <td className="pv-risk-today">
              {fmtScore(comparison.todayRiskScore)}
            </td>
            <td className="pv-risk-prev">
              {comparison.previousRiskScore == null
                ? "—"
                : `← ${fmtScore(comparison.previousRiskScore)}`}
            </td>
            <td
              className={`pv-risk-delta ${riskDeltaClass(
                comparison.todayRiskScore != null &&
                  comparison.previousRiskScore != null
                  ? comparison.todayRiskScore - comparison.previousRiskScore
                  : null,
              )}`}
            >
              {riskDeltaLabel(
                comparison.todayRiskScore != null &&
                  comparison.previousRiskScore != null
                  ? comparison.todayRiskScore - comparison.previousRiskScore
                  : null,
                lang,
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {comparison.previousSession ? (
        <small className="pv-risk-compare-note">
          {lang === "zh"
            ? `对比：${comparison.todaySession} vs ${comparison.previousSession}`
            : `Compare: ${comparison.todaySession} vs ${comparison.previousSession}`}
        </small>
      ) : null}
    </div>
  );
}

export function SentimentRiskCard({
  riskScore,
  sessionDate,
  comparison,
  lang,
}: {
  readonly riskScore: number | null;
  readonly sessionDate: string | null;
  readonly comparison: RiskSessionComparison | null;
  readonly lang: V2Language;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const canShowDetails = comparison !== null;

  return (
    <>
      <div className="pv-sentiment-head">
        <h3>SENTIMENT / RISK</h3>
        {canShowDetails && !showDetails ? (
          <button
            type="button"
            className="pv-details-btn"
            onClick={() => setShowDetails(true)}
          >
            {lang === "zh" ? "详情" : "DETAILS"}
          </button>
        ) : null}
        {showDetails ? (
          <button
            type="button"
            className="pv-details-btn"
            onClick={() => setShowDetails(false)}
          >
            {lang === "zh" ? "返回" : "BACK"}
          </button>
        ) : null}
      </div>

      {showDetails && comparison ? (
        <RiskDetailsTable comparison={comparison} lang={lang} />
      ) : (
        <>
          <div className="pv-gauge">
            <div className="arc" />
            <b>{riskScore ?? "—"}</b>
          </div>
          <p className="center">{riskLabel(riskScore, lang)}</p>
          <small className="pv-risk-asof">
            {lang === "zh" ? "数据日期" : "as of"} {sessionDate ?? "—"}
          </small>
        </>
      )}
    </>
  );
}
