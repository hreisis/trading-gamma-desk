import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { resolveRuntimeDataRoot, resolveDeskRequestAsync } from "./production-runtime";
import {
  buildRiskSessionComparison,
  buildRiskChangeReason,
  deriveRiskDecisionV1,
  loadPriorPublishedRiskDecisionForMarketSessionAsync,
} from "./risk-decision-v1";
import {
  breadthToRiskInput,
  deriveRiskDecisionV1_1,
  gammaToRiskInput,
} from "./risk-decision-v1-1";
import { resolveRuntimeJsonStore, type RuntimeJsonStore } from "./runtime-store";
import {
  buildManualGammaSummary,
  listManualGammaSnapshots,
  loadManualGammaSnapshot,
  type ManualGammaSnapshot,
} from "./manual-gamma";
import {
  loadV2HomePage,
  type LoadV2HomePageInput,
  type V2HomePageModel,
} from "./load-v2-home";
import { deriveOpportunityScoreV2 } from "./opportunity-score-v2";
import { derivePositioningV2, type PositioningV2Label } from "./positioning-v2";
import {
  deriveRiskTrendV2,
  type RiskTrendSnapshot,
  type RiskTrendV2Label,
} from "./risk-trend-v2";
import {
  priorCompletedSession,
  replayRiskHistoryForDate,
} from "./replay-risk-history";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { DailyBar } from "@/desk/breadth/bars/types";
import type { V2GammaSummary, V2SpyBreadthSummary } from "./v2-command-center";
import {
  buildV2AiStudyFallback,
  buildV2AiStudyPayload,
  generateV2CommandAiStudyInterpretation,
} from "@/ai-study/v2-command-interpret";
import { loadAiStudyLlmConfig } from "@/ai-study/config";
import { generateV2DailyReviewInterpretation } from "@/ai-study/v2-daily-review-interpret";
import { buildDeterministicV2DailyReview } from "./command-center-v1";

export type V2MarketPageModel = V2HomePageModel & {
  readonly manualGammaSnapshot: ManualGammaSnapshot | null;
  readonly manualGammaHistoryDates: readonly string[];
  readonly opportunityScoreV2: number | null;
  readonly riskTrend: RiskTrendV2Label | null;
  readonly riskTrendReasons: readonly string[];
  readonly positioning: PositioningV2Label | null;
};

function withOpportunityV2(
  view: V2HomePageModel["view"],
  opportunityScoreV2: number | null,
): V2HomePageModel["view"] {
  return { ...view, opportunityScore: opportunityScoreV2 };
}

function contributionScore(
  contributions: readonly { readonly id: string; readonly score: number }[] | undefined,
  id: string,
): number | null {
  return contributions?.find((row) => row.id === id)?.score ?? null;
}

function macroDirectionOf(
  driver: DominantDriver | null,
  fallback: string | null,
): RiskTrendSnapshot["macroDirection"] {
  const value = driver?.riskDirection ?? fallback;
  if (value === "risk_on" || value === "mixed" || value === "risk_off") {
    return value;
  }
  return null;
}

function buildMarketRiskTrendSnapshot(input: {
  readonly sessionDate: string;
  readonly riskScore: number | null;
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly macroScore: number | null;
  readonly macroDirection: RiskTrendSnapshot["macroDirection"];
  readonly spyGamma: V2GammaSummary | null;
}): RiskTrendSnapshot {
  const vol = input.spyGamma?.volMispricing;
  return {
    sessionDate: input.sessionDate,
    riskScore: input.riskScore,
    breadthSignal:
      input.spyBreadth.breadthSignalStatus === "available"
        ? input.spyBreadth.breadthSignal
        : null,
    advancingPct: input.spyBreadth.advancingPct ?? null,
    macroScore: input.macroScore,
    macroDirection: input.macroDirection,
    gammaRegime: input.spyGamma?.regime ?? null,
    volSignal:
      vol?.status === "available" &&
      (vol.signal === "vol_underpriced" ||
        vol.signal === "balanced" ||
        vol.signal === "vol_expensive")
        ? vol.signal
        : null,
    volSpread: vol?.status === "available" ? vol.spreadVolPts : null,
  };
}

async function computeMarketV2Policy(input: {
  readonly dataRoot: string;
  readonly sessionDate: string;
  readonly riskScore: number | null;
  readonly spyGamma: V2GammaSummary | null;
  readonly qqqGamma: V2GammaSummary | null;
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly eventGate: EventGateSnapshot | null;
  readonly driver: DominantDriver | null;
  readonly macroFallbackDirection: string | null;
  readonly factorContributions:
    | readonly { readonly id: string; readonly score: number }[]
    | undefined;
  readonly spyBars: readonly DailyBar[];
  readonly skipPrior?: boolean;
}): Promise<{
  readonly opportunityScoreV2: number | null;
  readonly riskTrend: RiskTrendV2Label;
  readonly riskTrendReasons: readonly string[];
  readonly positioning: PositioningV2Label;
}> {
  const opportunity = deriveOpportunityScoreV2({
    spyGamma: input.spyGamma,
    qqqGamma: input.qqqGamma,
    breadth: {
      breadthSignalStatus: input.spyBreadth.breadthSignalStatus,
      breadthSignal: input.spyBreadth.breadthSignal,
      advancingPct: input.spyBreadth.advancingPct ?? null,
    },
    eventGate: input.eventGate,
  });
  const current = buildMarketRiskTrendSnapshot({
    sessionDate: input.sessionDate,
    riskScore: input.riskScore,
    spyBreadth: input.spyBreadth,
    macroScore: contributionScore(input.factorContributions, "macro"),
    macroDirection: macroDirectionOf(input.driver, input.macroFallbackDirection),
    spyGamma: input.spyGamma,
  });
  const priorDate =
    input.skipPrior === true
      ? null
      : priorCompletedSession(input.sessionDate, input.spyBars);
  const priorRow =
    priorDate === null
      ? null
      : await replayRiskHistoryForDate(priorDate, { dataRoot: input.dataRoot });
  const trend = deriveRiskTrendV2({
    current,
    prior: priorRow?.trendSnapshot ?? null,
    priorDate,
  });
  return {
    opportunityScoreV2: opportunity.opportunityScore,
    riskTrend: trend.trend,
    riskTrendReasons: trend.reasons,
    positioning: derivePositioningV2({
      riskScore: input.riskScore,
      opportunityScore: opportunity.opportunityScore,
      trend: trend.trend,
    }),
  };
}

async function withMarketDecisionNarratives(input: {
  readonly view: V2HomePageModel["view"];
  readonly policy: {
    readonly opportunityScoreV2: number | null;
    readonly riskTrend: RiskTrendV2Label;
    readonly riskTrendReasons: readonly string[];
    readonly positioning: PositioningV2Label;
  };
  readonly demo: boolean;
  readonly dataRoot: string;
  readonly now: Date;
  readonly artifactStore?: RuntimeJsonStore;
  readonly equityBarsBySymbol?: ReadonlyMap<string, readonly DailyBar[]>;
}): Promise<V2HomePageModel["view"]> {
  const historicalPolicy = {
    positioning: input.policy.positioning,
    riskTrend: input.policy.riskTrend,
    trendReasons: input.policy.riskTrendReasons,
  };
  const payload = buildV2AiStudyPayload(
    input.view,
    input.view.eventGate,
    historicalPolicy,
  );
  if (input.demo) {
    return { ...input.view, aiStudy: buildV2AiStudyFallback(payload) };
  }

  const llmEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_STUDY_LLM_MODEL: process.env.AI_STUDY_LLM_MODEL,
  };
  const llmConfig = loadAiStudyLlmConfig(llmEnv);
  const aiStudy = await generateV2CommandAiStudyInterpretation({
    payload,
    config: llmConfig,
    env: llmEnv,
  });
  const { review, context } = await buildDeterministicV2DailyReview({
    now: input.now,
    demo: false,
    dataRoot: input.dataRoot,
    artifactStore: input.artifactStore,
    equityBarsBySymbol: input.equityBarsBySymbol,
    positioning: input.policy.positioning,
  });
  const dailyReview =
    review.status !== "ready" || context === null
      ? review
      : await generateV2DailyReviewInterpretation({
          review,
          context,
          view: input.view,
          config: llmConfig,
          env: llmEnv,
        });
  return { ...input.view, aiStudy, dailyReview };
}

export async function loadV2MarketPage(
  input: LoadV2HomePageInput & { readonly lang?: string },
): Promise<V2MarketPageModel> {
  const base = await loadV2HomePage(input);
  const dataRoot = resolveRuntimeDataRoot(process.env);
  const policyFromView = async (
    spyBars: readonly DailyBar[],
    extras?: {
      readonly spyGamma?: V2GammaSummary | null;
      readonly qqqGamma?: V2GammaSummary | null;
      readonly riskScore?: number | null;
      readonly sessionDate?: string;
      readonly driver?: DominantDriver | null;
      readonly factorContributions?:
        | readonly { readonly id: string; readonly score: number }[]
        | undefined;
      readonly skipPrior?: boolean;
    },
  ) =>
    computeMarketV2Policy({
      dataRoot,
      sessionDate: extras?.sessionDate ?? base.view.sessionDate ?? "",
      riskScore: extras?.riskScore ?? base.view.riskScore,
      spyGamma: extras?.spyGamma ?? base.view.gamma[0] ?? null,
      qqqGamma: extras?.qqqGamma ?? base.view.gamma[1] ?? null,
      spyBreadth: base.view.spyBreadth,
      eventGate: base.view.eventGate,
      driver: extras?.driver ?? null,
      macroFallbackDirection: base.view.macroSummary?.riskDirection ?? null,
      factorContributions:
        extras?.factorContributions ??
        (base.view.riskSessionComparison?.factors ?? [])
          .filter(
            (row): row is typeof row & { todayScore: number } =>
              row.todayScore != null,
          )
          .map((row) => ({ id: row.id, score: row.todayScore })),
      spyBars,
      skipPrior: extras?.skipPrior,
    });

  if (input.demo) {
    const policy = await policyFromView([], { skipPrior: true });
    const view = await withMarketDecisionNarratives({
      view: withOpportunityV2(base.view, policy.opportunityScoreV2),
      policy,
      demo: true,
      dataRoot,
      now: new Date(),
    });
    return {
      ...base,
      view,
      ...policy,
      manualGammaSnapshot: null,
      manualGammaHistoryDates: [],
    };
  }

  const now = new Date();
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const store = resolveRuntimeJsonStore(process.env);
  const [snapshot, history] = await Promise.all([
    loadManualGammaSnapshot(store, targetSession),
    listManualGammaSnapshots(store),
  ]);

  if (!snapshot) {
    const barPanel = await loadAlpacaDailyBarPanel({
      symbols: ["SPY", "QQQ"],
      env: process.env,
      dataRoot,
    }).catch(() => null);
    const spyBars = barPanel?.seriesBySymbol?.get("SPY")?.bars ?? [];
    const policy = await policyFromView(spyBars, {
      sessionDate: base.view.sessionDate ?? targetSession,
    });
    const equityBarsBySymbol = new Map<string, readonly DailyBar[]>();
    const spyFull = barPanel?.seriesBySymbol?.get("SPY")?.bars;
    const qqqFull = barPanel?.seriesBySymbol?.get("QQQ")?.bars;
    if (spyFull) equityBarsBySymbol.set("SPY", spyFull);
    if (qqqFull) equityBarsBySymbol.set("QQQ", qqqFull);
    const view = await withMarketDecisionNarratives({
      view: withOpportunityV2(base.view, policy.opportunityScoreV2),
      policy,
      demo: false,
      dataRoot,
      now,
      artifactStore: store,
      equityBarsBySymbol,
    });
    return {
      ...base,
      view,
      ...policy,
      manualGammaSnapshot: null,
      manualGammaHistoryDates: history.map((row) => row.marketSessionDate),
    };
  }

  const [barPanel, macro] = await Promise.all([
    loadAlpacaDailyBarPanel({
      symbols: ["SPY", "QQQ"],
      env: process.env,
      dataRoot,
    }).catch(() => null),
    resolveDeskRequestAsync({
      source: input.source,
      publicDemo: false,
      dataRoot,
    }),
  ]);

  const spyBarList = barPanel?.seriesBySymbol?.get("SPY")?.bars;
  const qqqBarList = barPanel?.seriesBySymbol?.get("QQQ")?.bars;
  const spyBars = spyBarList ?? [];
  const spyGamma = buildManualGammaSummary({
    snapshot,
    symbol: "SPY",
    hv20Bars: spyBarList,
  });
  const qqqGamma = buildManualGammaSummary({
    snapshot,
    symbol: "QQQ",
    hv20Bars: qqqBarList,
  });

  const decision = deriveRiskDecisionV1({
    driver: macro.driver,
    spyBreadth: breadthToRiskInput(base.view.spyBreadth),
    spyGamma: gammaToRiskInput(spyGamma),
    eventGate: base.view.eventGate,
    sectorRotation: base.view.sectorRotation,
    targetSession: snapshot.marketSessionDate,
  });

  const equityBarsBySymbol = new Map<
    string,
    readonly { readonly sessionDate: string; readonly close: number }[]
  >();
  if (spyBarList) equityBarsBySymbol.set("SPY", spyBarList);
  if (qqqBarList) equityBarsBySymbol.set("QQQ", qqqBarList);

  // Reuse the canonical SPY/QQQ structural-risk model, but swap in the
  // manual Gamma + IV snapshot. Other factors stay on their existing live
  // pipelines; no model weights or scoring rules are changed here.
  const structural = deriveRiskDecisionV1_1({
    driver: macro.driver,
    spyBreadth: base.view.spyBreadth,
    qqqBreadth: base.view.qqqBreadth,
    spyGamma,
    qqqGamma,
    eventGate: base.view.eventGate,
    sectorRotation: base.view.sectorRotation,
    targetSession: snapshot.marketSessionDate,
    equityBarsBySymbol,
    // Do not reuse the automatic-provider prior divergence for a manual
    // snapshot. Trend remains unavailable until a comparable manual history
    // point exists.
    priorDivergence: null,
  });

  const previous = await loadPriorPublishedRiskDecisionForMarketSessionAsync(
    store,
    snapshot.marketSessionDate,
  );
  const comparison = buildRiskSessionComparison({
    decisionSessionDate: snapshot.marketSessionDate,
    today: decision,
    priorRecord: previous,
  });
  const riskChange =
    decision.status === "ready" &&
    decision.riskScore !== null &&
    previous !== null
      ? decision.riskScore - previous.riskScore
      : null;
  const riskChangeReason =
    riskChange !== null && previous !== null
      ? buildRiskChangeReason(
          riskChange,
          decision.factorContributions,
          previous.factorContributions,
        )
      : null;

  const policy = await policyFromView(spyBars, {
    sessionDate: snapshot.marketSessionDate,
    riskScore: decision.riskScore,
    spyGamma,
    qqqGamma,
    driver: macro.driver,
    factorContributions: decision.factorContributions,
  });

  const overlayed = {
    ...base.view,
    decisionStatus: (decision.status === "ready" ? "ready" : "awaiting_inputs") as
      V2HomePageModel["view"]["decisionStatus"],
    stance: decision.stance,
    riskScore: decision.riskScore,
    riskChange,
    riskChangeReason,
    riskSessionComparison: comparison,
    opportunityScore: policy.opportunityScoreV2,
    exposure: decision.exposure,
    allocation: decision.allocation,
    evidence: decision.evidence,
    missingInputs:
      decision.status === "withheld"
        ? decision.withheldFactors
        : base.view.missingInputs,
    gamma: [spyGamma, qqqGamma] as const,
    sessionDate: snapshot.marketSessionDate,
    spyStructuralRiskScore: structural.spyStructuralRisk.riskScore,
    qqqStructuralRiskScore: structural.qqqStructuralRisk.riskScore,
    riskDivergence: structural.riskDivergence,
    riskDivergenceChange: structural.riskDivergenceChange,
    riskDivergenceTrend: structural.riskDivergenceTrend,
    componentDivergence: structural.componentDivergence,
  };
  const reviewBars = new Map<string, readonly DailyBar[]>();
  if (spyBarList) reviewBars.set("SPY", spyBarList);
  if (qqqBarList) reviewBars.set("QQQ", qqqBarList);
  const view = await withMarketDecisionNarratives({
    view: overlayed,
    policy,
    demo: false,
    dataRoot,
    now,
    artifactStore: store,
    equityBarsBySymbol: reviewBars,
  });

  return {
    ...base,
    view,
    ...policy,
    manualGammaSnapshot: snapshot,
    manualGammaHistoryDates: history.map((row) => row.marketSessionDate),
  };
}
