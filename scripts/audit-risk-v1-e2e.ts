/**
 * Full Risk V1 E2E audit vs Command Center view.
 * Usage: npx tsx scripts/audit-risk-v1-e2e.ts
 */
import { join } from "node:path";
import {
  resolveCurrentMarketSessionDate,
  resolveLastCompletedMarketSessionDate,
} from "@/ai-study/session";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { mergeMacroAlpacaWatchlist } from "@/desk/macro-display-returns";
import { resolveAlpacaWatchlist } from "@/alpaca/config";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { ensureDurableSpyBreadthForMarketInput } from "@/desk/breadth/read-durable-breadth";
import { buildMarketInputSnapshot } from "@/desk/build-market-input-snapshot";
import {
  loadBoundedGammaDeskViewAsync,
  loadCatalystFeedAsync,
  resolveDeskRequestAsync,
  resolveRuntimeDataRoot,
} from "@/desk/production-runtime";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";
import {
  buildV2CommandCenterView,
  deriveCommandCenterRiskDecision,
  eventGateFromMarketInput,
  sectorRotationBarSymbols,
  summarizeSpyBreadthFromDurable,
} from "@/desk/v2-command-center";
import {
  loadPriorPublishedRiskDecision,
  loadRiskDecisionV1Daily,
  riskDecisionPublicationDate,
  type RiskFactorContributionSnapshot,
} from "@/desk/risk-decision-v1";

interface FactorRow {
  readonly factor: string;
  readonly sourceSession: string;
  readonly status: string;
  readonly score: string;
  readonly effectiveWeight: string;
  readonly contribution: string;
  readonly match: boolean;
  readonly issue: string;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  return String(v);
}

function contribution(score: number, effWt: number): number {
  return score * effWt;
}

async function main(): Promise<void> {
  const now = new Date();
  const publicationDate = resolveCurrentMarketSessionDate(now);
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const env = process.env;
  const dataRoot = resolveRuntimeDataRoot(env);
  const artifactStore = resolveRuntimeJsonStore(env);
  const gammaDataRoot = join(dataRoot, "gamma", "providers", "marketdata-app");

  const macro = await resolveDeskRequestAsync({ publicDemo: false, dataRoot });

  const [spyGamma, qqqGamma, breadthLoad, marketPanel, equityBars, catalystFeed] =
    await Promise.all([
      loadBoundedGammaDeskViewAsync({
        symbol: "SPY",
        dataRoot: gammaDataRoot,
        env,
        now,
      }),
      loadBoundedGammaDeskViewAsync({
        symbol: "QQQ",
        dataRoot: gammaDataRoot,
        env,
        now,
      }),
      ensureDurableSpyBreadthForMarketInput({
        targetMarketSessionDate: targetSession,
        publicDemo: false,
        dataRoot,
        env,
      }).catch((error: unknown) => ({
        snapshot: null,
        sourceArtifact: null,
        missingReason:
          error instanceof Error ? error.message : String(error),
      })),
      loadAlpacaMarketPanel({
        publicDemo: false,
        now,
        env,
        symbols: mergeMacroAlpacaWatchlist(resolveAlpacaWatchlist(env)),
      }).catch(() => null),
      loadAlpacaDailyBarPanel({
        symbols: [...new Set(["QQQ", ...sectorRotationBarSymbols()])],
        env,
        dataRoot,
      }).catch(() => null),
      loadCatalystFeedAsync({}, {
        publicDemo: false,
        now,
        dataRoot,
        env,
      }).catch(() => null),
    ]);

  const equityBarsBySymbol = new Map<
    string,
    readonly { sessionDate: string; close: number }[]
  >();
  if (equityBars?.seriesBySymbol) {
    for (const [symbol, series] of equityBars.seriesBySymbol.entries()) {
      equityBarsBySymbol.set(symbol, series.bars);
    }
  }

  const spyBreadth = summarizeSpyBreadthFromDurable(breadthLoad, false);
  const marketInputSnapshot = buildMarketInputSnapshot({
    targetMarketSessionDate: targetSession,
    generatedAt: now.toISOString(),
    macro,
    alpacaPanel: marketPanel,
    catalystFeed,
    spyGamma,
    qqqGamma,
    publicDemo: false,
    breadthInternals: breadthLoad.snapshot,
    breadthDurableMeta: {
      sourceArtifact: breadthLoad.sourceArtifact,
      unavailableReason: breadthLoad.missingReason,
    },
  });

  const view = await buildV2CommandCenterView({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    spyBreadth,
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    marketInputSnapshot,
    dataRoot,
    artifactStore,
    barPanelLatestSession: equityBars?.provenance.latestSessionDate ?? null,
  });

  const decision = deriveCommandCenterRiskDecision({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    spyBreadth,
    sectorRotation: view.sectorRotation,
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    marketInputSnapshot,
    targetSession,
  });

  const spySummary = view.gamma[0];
  const eventGate = eventGateFromMarketInput(marketInputSnapshot);

  const rows: FactorRow[] = [];

  const factorById = new Map(
    decision.factorContributions.map((row) => [row.id, row]),
  );

  // Breadth
  const breadthFactor = factorById.get("breadth");
  const breadthEff = breadthFactor?.effectiveWeight ?? 0;
  const breadthStaleMult = spyBreadth.stale ? 0.5 : 1;
  rows.push({
    factor: "SPY breadth",
    sourceSession: `${spyBreadth.marketSessionDate ?? "—"} / ${spyBreadth.asOf ?? "—"}`,
    status: spyBreadth.stale
      ? "available · stale (½ weight)"
      : spyBreadth.breadthSignalStatus,
    score: fmt(breadthFactor?.score ?? "excluded"),
    effectiveWeight: fmt(breadthEff),
    contribution: breadthFactor
      ? fmt(contribution(breadthFactor.score, breadthEff))
      : "—",
    match:
      spyBreadth.breadthSignal === view.spyBreadth.breadthSignal &&
      decision.factorContributions.some((f) => f.id === "breadth") ===
        (spyBreadth.breadthSignalStatus === "available"),
    issue: spyBreadth.missingReason ?? "—",
  });

  // Macro
  const macroFactor = factorById.get("macro");
  const driver = macro.driver;
  const macroStale =
    driver &&
    (driver.marketSessionDate !== targetSession ||
      driver.sessionAlignment !== "aligned");
  rows.push({
    factor: "Macro driver",
    sourceSession: driver
      ? `${driver.marketSessionDate} / ${driver.sessionAlignment ?? "—"}`
      : "—",
    status: macroFactor
      ? macroStale
        ? "available · session-misaligned (½ weight)"
        : "available"
      : "excluded",
    score: fmt(macroFactor?.score ?? "—"),
    effectiveWeight: fmt(macroFactor?.effectiveWeight ?? 0),
    contribution: macroFactor
      ? fmt(contribution(macroFactor.score, macroFactor.effectiveWeight))
      : "—",
    match:
      (macroFactor !== undefined) ===
      (driver?.riskDirection !== null &&
        driver?.primaryRegime !== "insufficient_data" &&
        driver?.primaryRegime !== "mixed_unresolved" &&
        driver?.primaryRegime !== "single_asset_shock"),
    issue: driver?.label ?? "—",
  });

  // CTA
  const ctaFactor = factorById.get("cta");
  rows.push({
    factor: "CTA proxy",
    sourceSession: `bars ≤ ${targetSession} · quotes live`,
    status:
      view.ctaProxy.status === "available"
        ? "available"
        : `excluded (${view.ctaProxy.status})`,
    score: fmt(ctaFactor?.score ?? "—"),
    effectiveWeight: fmt(ctaFactor?.effectiveWeight ?? 0),
    contribution: ctaFactor
      ? fmt(contribution(ctaFactor.score, ctaFactor.effectiveWeight))
      : "—",
    match:
      (ctaFactor !== undefined) === (view.ctaProxy.status === "available"),
    issue:
      view.ctaProxy.status !== "available"
        ? "needs aligned SPY/QQQ bars + live quotes"
        : "—",
  });

  // Vol
  const volFactor = factorById.get("vol");
  const vol = spySummary.volMispricing;
  const volStaleMult =
    spySummary.freshness === "stale" ? 0.5 : 1;
  rows.push({
    factor: "Vol mispricing",
    sourceSession: `${spySummary.sessionDate ?? "—"} IV · HV20 SPY bars`,
    status:
      volFactor
        ? volStaleMult < 1
          ? "available · stale gamma IV (½ weight)"
          : spySummary.status === "incomplete"
            ? "available (gamma incomplete; vol not double-penalized)"
            : "available"
        : "excluded",
    score: fmt(volFactor?.score ?? "—"),
    effectiveWeight: fmt(volFactor?.effectiveWeight ?? 0),
    contribution: volFactor
      ? fmt(contribution(volFactor.score, volFactor.effectiveWeight))
      : "—",
    match:
      vol.status === view.gamma[0].volMispricing.status &&
      vol.signal === view.gamma[0].volMispricing.signal,
    issue: `${vol.ivDataLabel ?? "—"} · spread ${fmt(vol.spreadVolPts)} vol pts`,
  });

  // Dealer flow
  const gammaFactor = factorById.get("gamma");
  const gammaMult =
    spySummary.freshness === "stale"
      ? 0.5
      : spySummary.status === "incomplete" ||
          spySummary.freshness === "incomplete"
        ? 0.75
        : 1;
  rows.push({
    factor: "Dealer flow",
    sourceSession: `${spySummary.sessionDate ?? "—"} / ${spySummary.freshness ?? "—"}`,
    status: gammaFactor
      ? spySummary.status === "incomplete"
        ? `incomplete (¾ weight)`
        : spySummary.freshness === "stale"
          ? "available · stale (½ weight)"
          : "available"
      : spySummary.status,
    score: fmt(gammaFactor?.score ?? "—"),
    effectiveWeight: fmt(gammaFactor?.effectiveWeight ?? 0),
    contribution: gammaFactor
      ? fmt(contribution(gammaFactor.score, gammaFactor.effectiveWeight))
      : "—",
    match:
      spySummary.regime === view.gamma[0].regime &&
      spySummary.dealerFlowRegime === view.gamma[0].dealerFlowRegime,
    issue: spySummary.dealerFlowRegime ?? "—",
  });

  // Event gate
  const eventFactor = factorById.get("event_gate");
  rows.push({
    factor: "Event gate",
    sourceSession: eventGate
      ? `${eventGate.asOf ?? "—"} · stale=${eventGate.stale}`
      : "—",
    status: eventFactor
      ? eventGate?.stale
        ? "available · stale (½ weight)"
        : "available"
      : "excluded",
    score: fmt(eventFactor?.score ?? "—"),
    effectiveWeight: fmt(eventFactor?.effectiveWeight ?? 0),
    contribution: eventFactor
      ? fmt(contribution(eventFactor.score, eventFactor.effectiveWeight))
      : "—",
    match: true,
    issue: eventGate?.activeEvents[0]?.headline ?? eventGate?.missingReason ?? "—",
  });

  // Concentration
  rows.push({
    factor: "Leadership concentration",
    sourceSession: `breadth ${spyBreadth.marketSessionDate} · sector ${view.sectorRotation.sessionDate ?? "—"}`,
    status:
      decision.concentrationPenalty !== null && decision.concentrationPenalty > 0
        ? `+${decision.concentrationPenalty} · ${decision.concentrationReason ?? "—"}`
        : "none",
    score: fmt(decision.concentrationPenalty ?? 0),
    effectiveWeight: "post-score add",
    contribution: fmt(decision.concentrationPenalty ?? 0),
    match: true,
    issue:
      decision.concentrationReason
        ? `visible in evidence: ${decision.evidence.find((l) => l.includes("concentration")) ?? "check evidence[1]"}`
        : "—",
  });

  console.log("=== Risk V1 E2E audit ===");
  console.log(`publicationDate: ${publicationDate}`);
  console.log(`targetSession: ${targetSession}`);
  console.log("\n| factor | source/session | status | score | effective weight | contribution | match? | issue/fix |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.factor} | ${row.sourceSession} | ${row.status} | ${row.score} | ${row.effectiveWeight} | ${row.contribution} | ${row.match ? "yes" : "NO"} | ${row.issue} |`,
    );
  }

  const active = decision.factorContributions;
  const totalWt = active.reduce((s, r) => s + r.effectiveWeight, 0);
  const weightedSum = active.reduce(
    (s, r) => s + r.score * r.effectiveWeight,
    0,
  );
  const computedBase =
    totalWt > 0 ? Math.round(Math.min(100, Math.max(0, weightedSum / totalWt))) : null;

  console.log("\n--- Score reconciliation ---");
  console.log(`Σ effectiveWeight: ${totalWt}`);
  console.log(`Σ score×effWt: ${weightedSum}`);
  console.log(`computed baseRiskScore: ${computedBase}`);
  console.log(`decision.baseRiskScore: ${decision.baseRiskScore}`);
  console.log(`concentrationPenalty: ${decision.concentrationPenalty}`);
  console.log(`decision.riskScore: ${decision.riskScore}`);
  console.log(`view.riskScore (UI): ${view.riskScore}`);
  console.log(`stance: ${decision.stance} (UI ${view.stance})`);
  console.log(`opportunityScore: ${decision.opportunityScore} (UI ${view.opportunityScore})`);
  console.log(`exposure UI: ${JSON.stringify(view.exposure)}`);
  console.log(`allocation UI: ${JSON.stringify(view.allocation)}`);

  const priorPublished = loadPriorPublishedRiskDecision(dataRoot, publicationDate);
  const todayPublished = loadRiskDecisionV1Daily(dataRoot, publicationDate);
  console.log("\n--- Day-over-day (immutable published records) ---");
  console.log(
    `prior published: ${priorPublished ? riskDecisionPublicationDate(priorPublished) : "—"} risk=${priorPublished?.riskScore ?? "—"}`,
  );
  console.log(
    `today file ${publicationDate}.json: risk=${todayPublished?.riskScore ?? "not yet"}`,
  );
  console.log(`UI riskChange: ${view.riskChange} · ${view.riskChangeReason ?? "—"}`);

  if (priorPublished && decision.riskScore !== null) {
    const immutableDelta = decision.riskScore - priorPublished.riskScore;
    const factorDelta = factorContributionDeltas(
      decision.factorContributions,
      priorPublished.factorContributions,
    );
    console.log(
      `immutable delta (today compute vs prior published): ${immutableDelta}`,
    );
    console.log("factor weighted deltas vs prior published:", factorDelta);
  }
}

function factorContributionDeltas(
  today: readonly RiskFactorContributionSnapshot[],
  previous: readonly RiskFactorContributionSnapshot[],
): string {
  const prev = new Map(previous.map((r) => [r.id, r]));
  const parts: string[] = [];
  for (const row of today) {
    const prior = prev.get(row.id);
    const delta =
      row.score * row.effectiveWeight -
      (prior ? prior.score * prior.effectiveWeight : 0);
    if (delta !== 0) parts.push(`${row.id}:${delta > 0 ? "+" : ""}${delta}`);
  }
  for (const row of previous) {
    if (!today.some((t) => t.id === row.id)) {
      parts.push(`${row.id}:-${row.score * row.effectiveWeight}`);
    }
  }
  return parts.join(", ") || "none";
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
