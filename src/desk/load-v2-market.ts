import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { resolveRuntimeDataRoot, resolveDeskRequestAsync } from "./production-runtime";
import {
  buildRiskSessionComparison,
  buildRiskChangeReason,
  deriveRiskDecisionV1,
  loadPriorPublishedRiskDecisionForMarketSessionAsync,
} from "./risk-decision-v1";
import { breadthToRiskInput, gammaToRiskInput } from "./risk-decision-v1-1";
import { resolveRuntimeJsonStore } from "./runtime-store";
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

export type V2MarketPageModel = V2HomePageModel & {
  readonly manualGammaSnapshot: ManualGammaSnapshot | null;
  readonly manualGammaHistoryDates: readonly string[];
};

export async function loadV2MarketPage(
  input: LoadV2HomePageInput & { readonly lang?: string },
): Promise<V2MarketPageModel> {
  const base = await loadV2HomePage(input);
  if (input.demo) {
    return {
      ...base,
      manualGammaSnapshot: null,
      manualGammaHistoryDates: [],
    };
  }

  const now = new Date();
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const dataRoot = resolveRuntimeDataRoot(process.env);
  const store = resolveRuntimeJsonStore(process.env);
  const [snapshot, history] = await Promise.all([
    loadManualGammaSnapshot(store, targetSession),
    listManualGammaSnapshots(store),
  ]);

  if (!snapshot) {
    return {
      ...base,
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

  const spyBars = barPanel?.seriesBySymbol?.get("SPY")?.bars;
  const qqqBars = barPanel?.seriesBySymbol?.get("QQQ")?.bars;
  const spyGamma = buildManualGammaSummary({
    snapshot,
    symbol: "SPY",
    hv20Bars: spyBars,
  });
  const qqqGamma = buildManualGammaSummary({
    snapshot,
    symbol: "QQQ",
    hv20Bars: qqqBars,
  });

  const decision = deriveRiskDecisionV1({
    driver: macro.driver,
    spyBreadth: breadthToRiskInput(base.view.spyBreadth),
    spyGamma: gammaToRiskInput(spyGamma),
    ctaProxy: base.view.ctaProxy,
    eventGate: base.view.eventGate,
    sectorRotation: base.view.sectorRotation,
    targetSession: snapshot.marketSessionDate,
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

  return {
    ...base,
    view: {
      ...base.view,
      decisionStatus: decision.status === "ready" ? "ready" : "awaiting_inputs",
      stance: decision.stance,
      riskScore: decision.riskScore,
      riskChange,
      riskChangeReason,
      riskSessionComparison: comparison,
      opportunityScore: decision.opportunityScore,
      exposure: decision.exposure,
      allocation: decision.allocation,
      evidence: decision.evidence,
      missingInputs:
        decision.status === "withheld"
          ? decision.withheldFactors
          : base.view.missingInputs,
      gamma: [spyGamma, qqqGamma],
      sessionDate: snapshot.marketSessionDate,
    },
    manualGammaSnapshot: snapshot,
    manualGammaHistoryDates: history.map((row) => row.marketSessionDate),
  };
}
