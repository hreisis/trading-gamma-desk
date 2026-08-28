/**
 * Compact, rule-based interpretation of the four /market V2 outputs.
 * Display-only. Does not change Risk, Opportunity, Trend, or Positioning math.
 */
import type { PositioningV2Label } from "@/desk/positioning-v2";
import type { RiskTrendV2Label } from "@/desk/risk-trend-v2";
import type { V2Language } from "@/desk/v2-command-center";

export interface V2PolicyInterpretationInput {
  readonly riskScore: number | null;
  readonly opportunityScore: number | null;
  readonly trend: RiskTrendV2Label | null;
  readonly positioning: PositioningV2Label | null;
}

export function interpretV2Policy(
  input: V2PolicyInterpretationInput,
  lang: V2Language,
): readonly string[] {
  return [
    interpretRisk(input.riskScore, lang),
    interpretOpportunity(input.opportunityScore, lang),
    interpretTrend(input.trend, lang),
    interpretPositioning(input.positioning, lang),
  ];
}

function interpretRisk(score: number | null, lang: V2Language): string {
  if (score === null) {
    return lang === "zh" ? "风险 —：输入不足，暂不判断风险环境。" : "Risk —: Inputs are incomplete; risk regime is withheld.";
  }
  if (score <= 40) {
    return lang === "zh"
      ? `风险 ${score}：风险偏低，环境相对可控，但仍需看结构。`
      : `Risk ${score}: Risk is low. The backdrop is relatively controlled, but structure still matters.`;
  }
  if (score <= 50) {
    return lang === "zh"
      ? `风险 ${score}：风险中等，应按结构交易，而不是假设低风险。`
      : `Risk ${score}: Risk is moderate. Trade the structure; do not assume a low-risk regime.`;
  }
  if (score <= 65) {
    return lang === "zh"
      ? `风险 ${score}：风险中等偏高，不能当作低风险环境。`
      : `Risk ${score}: Risk is moderate-to-elevated. Do not treat this as a low-risk regime.`;
  }
  return lang === "zh"
    ? `风险 ${score}：风险偏高，优先控制回撤而不是追涨。`
    : `Risk ${score}: Risk is elevated. Prioritize drawdown control over chasing upside.`;
}

function interpretOpportunity(score: number | null, lang: V2Language): string {
  if (score === null) {
    return lang === "zh" ? "机会 —：机会分数暂缺，不能当作买点依据。" : "Opportunity —: Score unavailable; it is not a buy signal.";
  }
  if (score >= 65) {
    return lang === "zh"
      ? `机会 ${score}：当前存在一定战术性机会，但不是安全买点。`
      : `Opportunity ${score}: A tactical setup exists, but this is not a safe buy.`;
  }
  if (score >= 45) {
    return lang === "zh"
      ? `机会 ${score}：机会一般，最多适合观察或轻仓，不是明确加仓窗口。`
      : `Opportunity ${score}: Opportunity is only modest. Watch or size lightly; it is not a clear add window.`;
  }
  return lang === "zh"
    ? `机会 ${score}：战术性机会有限，不支持把它读成买点。`
    : `Opportunity ${score}: Tactical opportunity is limited. Do not read this as a buy.`;
}

function interpretTrend(trend: RiskTrendV2Label | null, lang: V2Language): string {
  if (trend === "deteriorating") {
    return lang === "zh" ? "趋势：恶化。风险结构正在继续变差。" : "Trend: deteriorating. The risk structure is still getting worse.";
  }
  if (trend === "improving") {
    return lang === "zh" ? "趋势：改善。风险结构正在好转。" : "Trend: improving. The risk structure is getting better.";
  }
  if (trend === "stable") {
    return lang === "zh" ? "趋势：平稳。相对前一交易日没有明确转向。" : "Trend: stable. No clear turn versus the prior session.";
  }
  return lang === "zh" ? "趋势 —：缺少可比前值，趋势暂不判断。" : "Trend —: No comparable prior session; trend is withheld.";
}

function interpretPositioning(
  positioning: PositioningV2Label | null,
  lang: V2Language,
): string {
  if (positioning === null) {
    return lang === "zh" ? "仓位建议 —：政策暂缺，维持观望。" : "Positioning —: Policy withheld; stay in wait mode.";
  }
  if (lang === "zh") {
    switch (positioning) {
      case "ADD":
        return "仓位建议：加仓。当前更适合增加风险敞口。";
      case "SELECTIVE ADD":
        return "仓位建议：选择性加仓。可以小幅参与，但不是全面加仓。";
      case "HOLD / WAIT":
        return "仓位建议：持有 / 观望。等待更好的风险或机会组合。";
      case "TACTICAL ADD":
        return "仓位建议：战术加仓。只适合小仓位试探，不是核心加仓。";
      case "HOLD":
        return "仓位建议：持有。维持现有仓位，不必因分数波动而动作。";
      case "TRIM / DEFENSIVE":
        return "仓位建议：减仓 / 防守。当前更适合降低风险敞口，而不是因为机会分数较高就加仓。";
      case "REDUCE CORE / TACTICAL REBOUND":
        return "仓位建议：减核心 / 战术反弹。核心仓位应降风险，机会只适合短线反弹。";
      case "REDUCE":
        return "仓位建议：减仓。优先降低风险敞口。";
    }
  }
  switch (positioning) {
    case "ADD":
      return "Positioning: ADD. The setup favors increasing risk exposure.";
    case "SELECTIVE ADD":
      return "Positioning: SELECTIVE ADD. Small participation is fine; this is not a full add.";
    case "HOLD / WAIT":
      return "Positioning: HOLD / WAIT. Wait for a better risk/opportunity mix.";
    case "TACTICAL ADD":
      return "Positioning: TACTICAL ADD. Probe with a small size; this is not a core add.";
    case "HOLD":
      return "Positioning: HOLD. Keep current exposure; do not trade the score noise.";
    case "TRIM / DEFENSIVE":
      return "Positioning: TRIM / DEFENSIVE. Reduce risk exposure rather than adding because Opportunity is high.";
    case "REDUCE CORE / TACTICAL REBOUND":
      return "Positioning: REDUCE CORE / TACTICAL REBOUND. Cut core risk; any rebound is tactical only.";
    case "REDUCE":
      return "Positioning: REDUCE. Cut risk exposure first.";
  }
}
