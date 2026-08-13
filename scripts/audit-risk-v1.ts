/**
 * Audit Risk V1 factor contributions for the current session.
 * Usage: npx tsx scripts/audit-risk-v1.ts
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
  deriveCommandCenterRiskDecision,
  eventGateFromMarketInput,
  summarizeSectorRotation,
  summarizeSpyBreadthFromDurable,
  sectorRotationBarSymbols,
  type V2SpyBreadthSummary,
} from "@/desk/v2-command-center";
import type { RiskDecisionSpyGammaInput } from "@/desk/risk-decision-v1";
import type { DominantDriver } from "@/contracts";
import type { EventGateSnapshot } from "@/contracts/event-gate";
import type { CtaProxySummary } from "@/desk/format-gamma";
import { summarizeCtaProxy, summarizeVolMispricing, dealerFlowRegimeLabel } from "@/desk/format-gamma";
import type { BoundedGammaDeskView } from "@/desk/load-bounded-gamma";

const BREADTH_WEIGHT = 25;
const MACRO_WEIGHT = 25;
const CTA_WEIGHT = 15;
const VOL_WEIGHT = 15;
const GAMMA_WEIGHT = 15;
const EVENT_GATE_WEIGHT = 10;

interface FactorAuditRow {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly rawSignal: string;
  readonly factorScore: number | null;
  readonly configuredWeight: number;
  readonly freshnessPenalty: number;
  readonly effectiveWeight: number;
  readonly weightedContribution: number | null;
  readonly detail: string;
}

function macroStale(driver: DominantDriver, targetSession: string): boolean {
  return (
    driver.marketSessionDate !== targetSession ||
    driver.sessionAlignment !== "aligned"
  );
}

function gammaWeightMultiplier(gamma: RiskDecisionSpyGammaInput): number {
  if (gamma.freshness === "stale") return 0.5;
  if (gamma.status === "incomplete" || gamma.freshness === "incomplete") {
    return 0.75;
  }
  return 1;
}

function auditFactorRows(input: {
  readonly driver: DominantDriver | null;
  readonly spyBreadth: V2SpyBreadthSummary;
  readonly spyGamma: RiskDecisionSpyGammaInput;
  readonly ctaProxy: CtaProxySummary;
  readonly eventGate: EventGateSnapshot | null;
  readonly targetSession: string;
}): FactorAuditRow[] {
  const rows: FactorAuditRow[] = [];

  // SPY breadth
  if (input.spyBreadth.breadthSignalStatus === "available") {
    const multiplier = input.spyBreadth.stale ? 0.5 : 1;
    const score =
      input.spyBreadth.breadthSignal === "strong"
        ? 25
        : input.spyBreadth.breadthSignal === "mixed"
          ? 50
          : input.spyBreadth.breadthSignal === "weak"
            ? 80
            : null;
    rows.push({
      id: "breadth",
      label: "SPY breadth",
      status: input.spyBreadth.stale ? "available (stale)" : "available",
      rawSignal: input.spyBreadth.breadthSignal ?? "—",
      factorScore: score,
      configuredWeight: BREADTH_WEIGHT,
      freshnessPenalty: BREADTH_WEIGHT - BREADTH_WEIGHT * multiplier,
      effectiveWeight: BREADTH_WEIGHT * multiplier,
      weightedContribution: score !== null ? score * BREADTH_WEIGHT * multiplier : null,
      detail: input.spyBreadth.breadthContextLine ?? "—",
    });
  } else {
    rows.push({
      id: "breadth",
      label: "SPY breadth",
      status: input.spyBreadth.status === "unavailable" ? "unavailable" : "excluded",
      rawSignal: "—",
      factorScore: null,
      configuredWeight: BREADTH_WEIGHT,
      freshnessPenalty: BREADTH_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: input.spyBreadth.missingReason ?? "signal unavailable",
    });
  }

  // Macro
  const macroUnavailable =
    !input.driver ||
    input.driver.riskDirection === null ||
    input.driver.primaryRegime === "insufficient_data" ||
    input.driver.primaryRegime === "mixed_unresolved" ||
    input.driver.primaryRegime === "single_asset_shock";

  if (!macroUnavailable && input.driver) {
    const driver = input.driver;
    const multiplier = macroStale(driver, input.targetSession) ? 0.5 : 1;
    const score =
      driver.riskDirection === "risk_on"
        ? 25
        : driver.riskDirection === "mixed"
          ? 55
          : driver.riskDirection === "risk_off"
            ? 80
            : null;
    rows.push({
      id: "macro",
      label: "Macro driver",
      status: multiplier < 1 ? "available (stale/session-misaligned)" : "available",
      rawSignal: `${driver.primaryRegime} / riskDirection=${driver.riskDirection}`,
      factorScore: score,
      configuredWeight: MACRO_WEIGHT,
      freshnessPenalty: MACRO_WEIGHT - MACRO_WEIGHT * multiplier,
      effectiveWeight: MACRO_WEIGHT * multiplier,
      weightedContribution:
        score !== null ? score * MACRO_WEIGHT * multiplier : null,
      detail: driver.label,
    });
  } else {
    rows.push({
      id: "macro",
      label: "Macro driver",
      status: "unavailable",
      rawSignal: input.driver
        ? `${input.driver.primaryRegime} / riskDirection=${input.driver.riskDirection ?? "null"}`
        : "not loaded",
      factorScore: null,
      configuredWeight: MACRO_WEIGHT,
      freshnessPenalty: MACRO_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: macroUnavailable
        ? input.driver?.label ?? "no driver"
        : "—",
    });
  }

  // CTA
  if (input.ctaProxy.status === "available" && input.ctaProxy.signal !== null) {
    const score =
      input.ctaProxy.signal === "buying"
        ? 25
        : input.ctaProxy.signal === "neutral"
          ? 50
          : input.ctaProxy.signal === "selling"
            ? 75
            : null;
    rows.push({
      id: "cta",
      label: "CTA proxy",
      status: "available",
      rawSignal: input.ctaProxy.signal,
      factorScore: score,
      configuredWeight: CTA_WEIGHT,
      freshnessPenalty: 0,
      effectiveWeight: CTA_WEIGHT,
      weightedContribution: score !== null ? score * CTA_WEIGHT : null,
      detail: input.ctaProxy.contextLine ?? "—",
    });
  } else {
    rows.push({
      id: "cta",
      label: "CTA proxy",
      status: "unavailable",
      rawSignal: input.ctaProxy.signal ?? "—",
      factorScore: null,
      configuredWeight: CTA_WEIGHT,
      freshnessPenalty: CTA_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: input.ctaProxy.contextLine ?? "needs SPY/QQQ quotes and bars",
    });
  }

  // Vol mispricing
  const vol = input.spyGamma.volMispricing;
  if (vol.status === "available" && vol.signal !== null) {
    const multiplier = input.spyGamma.freshness === "stale" ? 0.5 : 1;
    const score =
      vol.signal === "vol_underpriced"
        ? 30
        : vol.signal === "balanced"
          ? 50
          : vol.signal === "vol_expensive"
            ? 75
            : null;
    rows.push({
      id: "vol",
      label: "Vol mispricing",
      status:
        multiplier < 1 ? "available (stale gamma IV)" : "available",
      rawSignal: vol.signal,
      factorScore: score,
      configuredWeight: VOL_WEIGHT,
      freshnessPenalty: VOL_WEIGHT - VOL_WEIGHT * multiplier,
      effectiveWeight: VOL_WEIGHT * multiplier,
      weightedContribution:
        score !== null ? score * VOL_WEIGHT * multiplier : null,
      detail: `IV ${vol.ivPct ?? "—"}% · HV20 ${vol.hv20Pct ?? "—"}% · spread ${vol.spreadVolPts ?? "—"} vol pts`,
    });
  } else {
    rows.push({
      id: "vol",
      label: "Vol mispricing",
      status: "unavailable",
      rawSignal: vol.signal ?? "—",
      factorScore: null,
      configuredWeight: VOL_WEIGHT,
      freshnessPenalty: VOL_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: vol.ivDataLabel ?? "needs SPY IV and HV20 bars",
    });
  }

  // Dealer flow (gamma)
  if (
    input.spyGamma.regime !== null &&
    (input.spyGamma.status === "ready" || input.spyGamma.status === "incomplete")
  ) {
    const multiplier = gammaWeightMultiplier(input.spyGamma);
    const score =
      input.spyGamma.regime === "positive"
        ? 25
        : input.spyGamma.regime === "near_zero"
          ? 50
          : input.spyGamma.regime === "negative"
            ? 75
            : null;
    rows.push({
      id: "gamma",
      label: "Dealer flow",
      status:
        input.spyGamma.status === "incomplete"
          ? `incomplete (freshness=${input.spyGamma.freshness})`
          : input.spyGamma.freshness === "stale"
            ? "available (stale)"
            : "available",
      rawSignal: input.spyGamma.regime,
      factorScore: score,
      configuredWeight: GAMMA_WEIGHT,
      freshnessPenalty: GAMMA_WEIGHT - GAMMA_WEIGHT * multiplier,
      effectiveWeight: GAMMA_WEIGHT * multiplier,
      weightedContribution:
        score !== null ? score * GAMMA_WEIGHT * multiplier : null,
      detail: input.spyGamma.dealerFlowRegime ?? "—",
    });
  } else {
    rows.push({
      id: "gamma",
      label: "Dealer flow",
      status: input.spyGamma.status,
      rawSignal: input.spyGamma.regime ?? "—",
      factorScore: null,
      configuredWeight: GAMMA_WEIGHT,
      freshnessPenalty: GAMMA_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: "no bounded gamma snapshot",
    });
  }

  // Event gate
  if (input.eventGate && input.eventGate.status !== "unavailable") {
    const multiplier = input.eventGate.stale ? 0.5 : 1;
    const score =
      input.eventGate.state === "clear"
        ? 15
        : input.eventGate.state === "scheduled_risk"
          ? 60
          : input.eventGate.state === "active_shock"
            ? 90
            : null;
    rows.push({
      id: "event_gate",
      label: "Event gate",
      status: input.eventGate.stale ? "available (stale)" : "available",
      rawSignal: input.eventGate.state,
      factorScore: score,
      configuredWeight: EVENT_GATE_WEIGHT,
      freshnessPenalty: EVENT_GATE_WEIGHT - EVENT_GATE_WEIGHT * multiplier,
      effectiveWeight: EVENT_GATE_WEIGHT * multiplier,
      weightedContribution:
        score !== null ? score * EVENT_GATE_WEIGHT * multiplier : null,
      detail:
        input.eventGate.activeEvents[0]?.headline ??
        input.eventGate.missingReason ??
        "—",
    });
  } else {
    rows.push({
      id: "event_gate",
      label: "Event gate",
      status: "unavailable",
      rawSignal: input.eventGate?.state ?? "—",
      factorScore: null,
      configuredWeight: EVENT_GATE_WEIGHT,
      freshnessPenalty: EVENT_GATE_WEIGHT,
      effectiveWeight: 0,
      weightedContribution: null,
      detail: input.eventGate?.missingReason ?? "not loaded",
    });
  }

  return rows;
}

function buildSpyGammaRiskInput(
  view: BoundedGammaDeskView,
  equityBarsBySymbol: ReadonlyMap<
    string,
    readonly { sessionDate: string; close: number }[]
  >,
): RiskDecisionSpyGammaInput {
  const snapshot = view.snapshot ?? view.withheldSnapshot;
  const deskStatus: RiskDecisionSpyGammaInput["status"] =
    snapshot === null
      ? "unavailable"
      : snapshot.status === "incomplete"
        ? "incomplete"
        : snapshot.status === "unavailable"
          ? "unavailable"
          : "ready";
  const freshness =
    view.freshness ??
    (snapshot?.status === "incomplete" ? "incomplete" : "fresh");
  const showFlow = deskStatus === "ready" || deskStatus === "incomplete";
  const volMispricing = summarizeVolMispricing({
    representativeIv: snapshot?.representativeIv,
    hv20Bars: equityBarsBySymbol.get("SPY"),
    isFixture: view.isFixture,
  });
  return {
    status: deskStatus,
    freshness,
    regime: showFlow ? snapshot?.gammaRegime ?? null : null,
    dealerFlowRegime: showFlow
      ? snapshot?.gammaRegime
        ? dealerFlowRegimeLabel(snapshot.gammaRegime)
        : null
      : null,
    volMispricing,
  };
}

function liveEquityPrice(
  symbol: "SPY" | "QQQ",
  quotes: { symbol: string; latestPrice: number | null; status: string }[] | undefined,
): number | null {
  const quote = quotes?.find((row) => row.symbol === symbol);
  if (
    quote?.status === "available" &&
    quote.latestPrice !== null &&
    Number.isFinite(quote.latestPrice) &&
    quote.latestPrice > 0
  ) {
    return quote.latestPrice;
  }
  return null;
}

async function main() {
  const now = new Date();
  const publicationDate = resolveCurrentMarketSessionDate(now);
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const env = process.env;
  const dataRoot = resolveRuntimeDataRoot(env);
  const artifactStore = resolveRuntimeJsonStore(env);
  const gammaDataRoot = join(dataRoot, "gamma", "providers", "marketdata-app");

  console.log("=== Risk V1 factor audit ===");
  console.log("now:", now.toISOString());
  console.log("publicationDate:", publicationDate);
  console.log("targetSession (inputs):", targetSession);
  console.log("dataRoot:", dataRoot);

  const macro = await resolveDeskRequestAsync({
    publicDemo: false,
    dataRoot,
  });

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

  const decision = deriveCommandCenterRiskDecision({
    driver: macro.driver,
    spyGamma,
    qqqGamma,
    spyBreadth,
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    marketInputSnapshot,
    targetSession,
  });

  const sectorRotation = summarizeSectorRotation({
    equityBarsBySymbol,
    targetSession,
    barPanelLatestSession: equityBars?.provenance.latestSessionDate ?? null,
  });

  const spyGammaInput = buildSpyGammaRiskInput(spyGamma, equityBarsBySymbol);
  const eventGate = eventGateFromMarketInput(marketInputSnapshot);
  const ctaProxy = summarizeCtaProxy({
    spyBars: equityBarsBySymbol.get("SPY"),
    qqqBars: equityBarsBySymbol.get("QQQ"),
    spyPrice: liveEquityPrice("SPY", marketPanel?.quotes),
    qqqPrice: liveEquityPrice("QQQ", marketPanel?.quotes),
    targetSession,
  });

  const factorRows = auditFactorRows({
    driver: macro.driver,
    spyBreadth,
    spyGamma: spyGammaInput,
    ctaProxy,
    eventGate,
    targetSession,
  });

  const activeRows = factorRows.filter((r) => r.effectiveWeight > 0);
  const totalWeight = activeRows.reduce((s, r) => s + r.effectiveWeight, 0);
  const weightedSum = activeRows.reduce(
    (s, r) => s + (r.weightedContribution ?? 0),
    0,
  );
  const computedRisk =
    totalWeight > 0 ? Math.round(Math.min(100, Math.max(0, weightedSum / totalWeight))) : null;

  console.log("\n--- SPY breadth detail ---");
  console.log(JSON.stringify(spyBreadth, null, 2));

  console.log("\n--- Sector rotation ---");
  console.log(
    `status=${sectorRotation.status} stale=${sectorRotation.stale} session=${sectorRotation.sessionDate}`,
  );
  if (sectorRotation.missingReason) {
    console.log("missingReason:", sectorRotation.missingReason);
  }
  if (sectorRotation.sectors.length > 0) {
    const byClass = {
      leading: sectorRotation.sectors.filter((s) => s.classification === "leading"),
      improving: sectorRotation.sectors.filter((s) => s.classification === "improving"),
      neutral: sectorRotation.sectors.filter((s) => s.classification === "neutral"),
      weakening: sectorRotation.sectors.filter((s) => s.classification === "weakening"),
    };
    console.log(
      `counts: leading=${byClass.leading.length} improving=${byClass.improving.length} neutral=${byClass.neutral.length} weakening=${byClass.weakening.length}`,
    );
    console.log("topLeadingImproving:", sectorRotation.topLeadingImproving.join(", "));
    console.log("bottomWeakening:", sectorRotation.bottomWeakening.join(", "));
    for (const row of [...sectorRotation.sectors].sort((a, b) => b.rs5d - a.rs5d)) {
      console.log(
        `${row.symbol} ${row.classification} rs1d=${row.rs1d.toFixed(2)} rs5d=${row.rs5d.toFixed(2)} aboveMA20=${row.aboveMa20} aboveMA50=${row.aboveMa50}`,
      );
    }
  }

  console.log("\n--- Factor contributions ---");
  for (const row of factorRows) {
    const pctOfFinal =
      row.weightedContribution !== null && totalWeight > 0 && computedRisk !== null
        ? ((row.weightedContribution / totalWeight) / computedRisk * 100).toFixed(1)
        : "—";
    console.log(`\n${row.label} (${row.id})`);
    console.log(`  status: ${row.status}`);
    console.log(`  raw signal: ${row.rawSignal}`);
    console.log(`  factor score: ${row.factorScore ?? "—"}`);
    console.log(`  configured weight: ${row.configuredWeight}`);
    console.log(`  freshness penalty: ${row.freshnessPenalty}`);
    console.log(`  effective weight: ${row.effectiveWeight}`);
    console.log(
      `  weighted contribution (score×effWt): ${row.weightedContribution ?? "—"}`,
    );
    console.log(`  detail: ${row.detail}`);
  }

  console.log("\n--- Mathematical breakdown ---");
  console.log(`Σ effectiveWeight = ${totalWeight}`);
  console.log(`Σ (score × effectiveWeight) = ${weightedSum}`);
  console.log(
    `riskScore = round(clamp(Σ(score×effWt) / ΣeffWt, 0, 100)) = ${computedRisk}`,
  );
  console.log(`deriveRiskDecisionV1 riskScore = ${decision.riskScore}`);
  console.log(`stance = ${decision.stance}`);
  console.log(`status = ${decision.status}`);
  if (decision.coverage) {
    console.log(
      `coverage: ${decision.coverage.effectiveWeight}% · confidence=${decision.coverage.confidence} · factors=${decision.coverage.factorsUsed.join(", ")}`,
    );
  }
  if (decision.withheldReason) {
    console.log("withheldReason:", decision.withheldReason);
    console.log("withheldFactors:", decision.withheldFactors);
  }

  console.log("\n--- Per-factor share of weighted sum ---");
  for (const row of activeRows) {
    const share =
      weightedSum > 0
        ? ((row.weightedContribution ?? 0) / weightedSum * 100).toFixed(1)
        : "—";
    console.log(
      `${row.id}: ${row.weightedContribution} / ${weightedSum} = ${share}% of numerator`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
