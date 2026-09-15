/**
 * Risk Trend V2 — session-to-session change label.
 * Separate from Risk Decision V1 scoring. Higher risk / weaker internals → deteriorating.
 */
export const RISK_TREND_V2_VERSION = "0.1.0";

export const RISK_TREND_LABELS = ["improving", "stable", "deteriorating"] as const;
export type RiskTrendV2Label = (typeof RISK_TREND_LABELS)[number];

export interface RiskTrendSnapshot {
  readonly sessionDate: string;
  readonly riskScore: number | null;
  readonly breadthSignal: "strong" | "mixed" | "weak" | null;
  readonly advancingPct: number | null;
  readonly macroScore: number | null;
  readonly macroDirection: "risk_on" | "mixed" | "risk_off" | null;
  readonly gammaRegime: string | null;
  readonly volSignal: "vol_underpriced" | "balanced" | "vol_expensive" | null;
  readonly volSpread: number | null;
}

export interface RiskTrendV2Result {
  readonly trend: RiskTrendV2Label;
  readonly priorDate: string | null;
  readonly reasons: readonly string[];
}

type VoteSign = -1 | 0 | 1;

interface Vote {
  readonly id: "risk_score" | "breadth" | "macro" | "gamma" | "vol";
  readonly sign: VoteSign;
  readonly magnitude: number;
  readonly reason: string;
}

const RISK_SCORE_BAND = 5;
const ADVANCING_BAND = 8;
const VOL_SPREAD_BAND = 1.5;
const NET_THRESHOLD = 2;

const BREADTH_RANK: Record<"strong" | "mixed" | "weak", number> = {
  strong: 0,
  mixed: 1,
  weak: 2,
};

const GAMMA_RANK: Record<string, number> = {
  positive: 0,
  near_zero: 1,
  negative: 2,
};

const VOL_RANK: Record<"vol_underpriced" | "balanced" | "vol_expensive", number> = {
  vol_underpriced: 0,
  balanced: 1,
  vol_expensive: 2,
};

const MACRO_LABEL: Record<number, string> = {
  25: "risk-on",
  55: "mixed",
  80: "risk-off",
};

function signFromDelta(
  worseningDelta: number,
  band: number,
): VoteSign {
  if (worseningDelta >= band) return -1;
  if (worseningDelta <= -band) return 1;
  return 0;
}

function rankVote(
  priorRank: number,
  currentRank: number,
  band = 1,
): { sign: VoteSign; magnitude: number } {
  const worsening = currentRank - priorRank;
  return {
    sign: signFromDelta(worsening, band),
    magnitude: Math.abs(worsening),
  };
}

function voteRiskScore(prior: RiskTrendSnapshot, current: RiskTrendSnapshot): Vote | null {
  if (prior.riskScore === null || current.riskScore === null) return null;
  const worsening = current.riskScore - prior.riskScore;
  const sign = signFromDelta(worsening, RISK_SCORE_BAND);
  return {
    id: "risk_score",
    sign,
    magnitude: Math.abs(worsening),
    reason: `Risk ${prior.riskScore} → ${current.riskScore}`,
  };
}

function voteBreadth(prior: RiskTrendSnapshot, current: RiskTrendSnapshot): Vote | null {
  if (prior.breadthSignal && current.breadthSignal) {
    const ranked = rankVote(
      BREADTH_RANK[prior.breadthSignal],
      BREADTH_RANK[current.breadthSignal],
    );
    if (ranked.sign !== 0 || prior.breadthSignal !== current.breadthSignal) {
      return {
        id: "breadth",
        sign: ranked.sign,
        magnitude: ranked.magnitude * 25,
        reason: `Breadth ${prior.breadthSignal} → ${current.breadthSignal}`,
      };
    }
  }
  if (
    prior.advancingPct !== null &&
    current.advancingPct !== null &&
    Number.isFinite(prior.advancingPct) &&
    Number.isFinite(current.advancingPct)
  ) {
    const worsening = prior.advancingPct - current.advancingPct;
    const sign = signFromDelta(worsening, ADVANCING_BAND);
    return {
      id: "breadth",
      sign,
      magnitude: Math.abs(worsening),
      reason: `Breadth advancing ${prior.advancingPct.toFixed(1)}% → ${current.advancingPct.toFixed(1)}%`,
    };
  }
  return null;
}

function voteMacro(prior: RiskTrendSnapshot, current: RiskTrendSnapshot): Vote | null {
  if (prior.macroScore === null || current.macroScore === null) return null;
  const worsening = current.macroScore - prior.macroScore;
  const sign = signFromDelta(worsening, 1);
  const priorLabel = prior.macroDirection ?? MACRO_LABEL[prior.macroScore] ?? String(prior.macroScore);
  const currentLabel =
    current.macroDirection ?? MACRO_LABEL[current.macroScore] ?? String(current.macroScore);
  return {
    id: "macro",
    sign,
    magnitude: Math.abs(worsening),
    reason: `Macro ${priorLabel} → ${currentLabel}`,
  };
}

function voteGamma(prior: RiskTrendSnapshot, current: RiskTrendSnapshot): Vote | null {
  const priorRank = prior.gammaRegime ? GAMMA_RANK[prior.gammaRegime] : undefined;
  const currentRank = current.gammaRegime ? GAMMA_RANK[current.gammaRegime] : undefined;
  if (priorRank === undefined || currentRank === undefined) return null;
  const ranked = rankVote(priorRank, currentRank);
  return {
    id: "gamma",
    sign: ranked.sign,
    magnitude: ranked.magnitude * 25,
    reason: `Gamma ${prior.gammaRegime} → ${current.gammaRegime}`,
  };
}

function voteVol(prior: RiskTrendSnapshot, current: RiskTrendSnapshot): Vote | null {
  if (
    prior.volSpread !== null &&
    current.volSpread !== null &&
    Number.isFinite(prior.volSpread) &&
    Number.isFinite(current.volSpread)
  ) {
    const worsening = current.volSpread - prior.volSpread;
    const sign = signFromDelta(worsening, VOL_SPREAD_BAND);
    if (sign !== 0 || prior.volSignal === current.volSignal || !prior.volSignal || !current.volSignal) {
      return {
        id: "vol",
        sign,
        magnitude: Math.abs(worsening),
        reason: `Vol spread ${formatSpread(prior.volSpread)} → ${formatSpread(current.volSpread)}`,
      };
    }
  }
  if (prior.volSignal && current.volSignal) {
    const ranked = rankVote(VOL_RANK[prior.volSignal], VOL_RANK[current.volSignal]);
    return {
      id: "vol",
      sign: ranked.sign,
      magnitude: ranked.magnitude * 20,
      reason: `Vol ${prior.volSignal} → ${current.volSignal}`,
    };
  }
  return null;
}

function formatSpread(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function labelFromNet(net: number): RiskTrendV2Label {
  if (net >= NET_THRESHOLD) return "improving";
  if (net <= -NET_THRESHOLD) return "deteriorating";
  return "stable";
}

function topReasons(
  votes: readonly Vote[],
  trend: RiskTrendV2Label,
  priorDate: string | null,
): string[] {
  if (!priorDate) return ["No prior completed session to compare"];
  const signed = votes.filter((vote) => vote.sign !== 0);
  const aligned = signed.filter((vote) =>
    trend === "improving" ? vote.sign > 0 : trend === "deteriorating" ? vote.sign < 0 : true,
  );
  const pool =
    trend === "stable"
      ? [...votes].sort((left, right) => right.magnitude - left.magnitude)
      : aligned.length > 0
        ? aligned
        : signed;
  const picked = [...pool]
    .sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3)
    .map((vote) => vote.reason);
  if (picked.length > 0) return picked;
  if (votes.length === 0) {
    return [`No comparable Risk/Breadth/Macro/Gamma/Vol vs prior session ${priorDate}`];
  }
  return ["Changes stayed inside the stable band vs prior session"];
}

export function deriveRiskTrendV2(input: {
  readonly current: RiskTrendSnapshot;
  readonly prior: RiskTrendSnapshot | null;
  readonly priorDate: string | null;
}): RiskTrendV2Result {
  if (!input.prior || !input.priorDate) {
    return {
      trend: "stable",
      priorDate: input.priorDate,
      reasons: ["No prior completed session to compare"],
    };
  }

  const votes = [
    voteRiskScore(input.prior, input.current),
    voteBreadth(input.prior, input.current),
    voteMacro(input.prior, input.current),
    voteGamma(input.prior, input.current),
    voteVol(input.prior, input.current),
  ].filter((vote): vote is Vote => vote !== null);

  const net = votes.reduce((sum, vote) => sum + vote.sign, 0);
  const trend = labelFromNet(net);
  return {
    trend,
    priorDate: input.priorDate,
    reasons: topReasons(votes, trend, input.priorDate),
  };
}
