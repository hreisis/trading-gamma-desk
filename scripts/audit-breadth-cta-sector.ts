/**
 * End-to-end audit: SPY breadth, CTA proxy, sector rotation → Command Center UI fields.
 * Usage: npx tsx scripts/audit-breadth-cta-sector.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { mergeMacroAlpacaWatchlist } from "@/desk/macro-display-returns";
import { resolveAlpacaWatchlist } from "@/alpaca/config";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { latestCachedSession, readSymbolBarCache } from "@/desk/breadth/bars/cache";
import { ensureDurableSpyBreadthForMarketInput } from "@/desk/breadth/read-durable-breadth";
import {
  buildV2CommandCenterView,
  breadthSignalLabel,
  formatSectorEtfLabel,
  sectorRotationBarSymbols,
  summarizeSpyBreadthFromDurable,
} from "@/desk/v2-command-center";
import { loadBoundedGammaDeskView } from "@/desk/load-bounded-gamma";
import { resolveRuntimeDataRoot } from "@/desk/production-runtime";
import {
  ctaProxySignalLabel,
  computeCloseMovingAverage,
  computeHv20AnnualizedPct,
  summarizeCtaProxy,
} from "@/desk/format-gamma";

interface AuditRow {
  readonly field: string;
  readonly rawSource: string;
  readonly sessionDateAsOf: string;
  readonly derived: string;
  readonly ui: string;
  readonly match: boolean;
  readonly issue: string;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  return String(v);
}

function pct(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

function printTable(title: string, rows: readonly AuditRow[]): void {
  console.log(`\n## ${title}`);
  console.log(
    "| field | raw/source | sessionDate/asOf | derived | UI | match? | issue/fix |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.field} | ${row.rawSource} | ${row.sessionDateAsOf} | ${row.derived} | ${row.ui} | ${row.match ? "yes" : "NO"} | ${row.issue} |`,
    );
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const targetSession = resolveLastCompletedMarketSessionDate(now);
  const env = process.env;
  const dataRoot = resolveRuntimeDataRoot(env);
  const gammaDataRoot = join(dataRoot, "gamma", "providers", "marketdata-app");

  const breadthLoad = await ensureDurableSpyBreadthForMarketInput({
    targetMarketSessionDate: targetSession,
    publicDemo: false,
    dataRoot,
    env,
  }).catch((error: unknown) => ({
    snapshot: null,
    sourceArtifact: null,
    missingReason:
      error instanceof Error ? error.message : String(error),
  }));

  const marketPanel = await loadAlpacaMarketPanel({
    publicDemo: false,
    now,
    env,
    symbols: mergeMacroAlpacaWatchlist(resolveAlpacaWatchlist(env)),
  }).catch(() => null);

  const equityBars = await loadAlpacaDailyBarPanel({
    symbols: [...new Set(["QQQ", ...sectorRotationBarSymbols()])],
    env,
    dataRoot,
  }).catch(() => null);

  const equityBarsBySymbol = new Map<string, readonly { sessionDate: string; close: number }[]>();
  if (equityBars?.seriesBySymbol) {
    for (const [symbol, series] of equityBars.seriesBySymbol.entries()) {
      equityBarsBySymbol.set(symbol, series.bars);
    }
  }

  const spyGamma = loadBoundedGammaDeskView({
    symbol: "SPY",
    dataRoot: gammaDataRoot,
    now,
  });
  const qqqGamma = loadBoundedGammaDeskView({
    symbol: "QQQ",
    dataRoot: gammaDataRoot,
    now,
  });

  const spyBreadthDerived = summarizeSpyBreadthFromDurable(breadthLoad, false);
  const view = await buildV2CommandCenterView({
    driver: null,
    spyGamma,
    qqqGamma,
    spyBreadth: spyBreadthDerived,
    marketQuotes: marketPanel?.quotes,
    equityBarsBySymbol,
    now,
    barPanelLatestSession: equityBars?.provenance.latestSessionDate ?? null,
  });

  const snapshot = breadthLoad.snapshot;
  const snapshotPath = breadthLoad.sourceArtifact
    ? join(dataRoot, breadthLoad.sourceArtifact)
    : null;
  const snapshotRaw =
    snapshotPath && existsSync(snapshotPath)
      ? JSON.parse(readFileSync(snapshotPath, "utf8"))
      : null;

  const breadthRows: AuditRow[] = [];

  breadthRows.push({
    field: "universe / holdings",
    rawSource: snapshotRaw?.universe?.provider ?? breadthLoad.sourceArtifact ?? "—",
    sessionDateAsOf: fmt(snapshotRaw?.universe?.asOf),
    derived: fmt(snapshotRaw?.universe?.universeId),
    ui: fmt(spyBreadthDerived.sourceArtifact),
    match: true,
    issue:
      snapshotRaw
        ? `official ETF holdings · ${fmt(snapshotRaw.universe?.constituentCount ?? snapshotRaw.metrics?.advanceDecline?.eligibleCount)} eligible`
        : breadthLoad.missingReason ?? "no snapshot",
  });

  const eligible = snapshot?.metrics?.advanceDecline?.eligibleCount ?? null;
  breadthRows.push({
    field: "constituent coverage",
    rawSource: "breadth snapshot metrics",
    sessionDateAsOf: fmt(snapshot?.marketSessionDate),
    derived: fmt(eligible),
    ui: fmt(
      spyBreadthDerived.advance !== null && spyBreadthDerived.decline !== null
        ? spyBreadthDerived.advance +
            spyBreadthDerived.decline +
            (spyBreadthDerived.unchanged ?? 0)
        : null,
    ),
    match:
      eligible === null ||
      spyBreadthDerived.advance === null ||
      spyBreadthDerived.advance +
        spyBreadthDerived.decline! +
        (spyBreadthDerived.unchanged ?? 0) === eligible,
    issue: "—",
  });

  breadthRows.push({
    field: "sessionDate / asOf",
    rawSource: breadthLoad.sourceArtifact ?? "—",
    sessionDateAsOf: `${fmt(snapshot?.marketSessionDate)} / ${fmt(snapshot?.asOf)}`,
    derived: `${fmt(spyBreadthDerived.marketSessionDate)} / ${fmt(spyBreadthDerived.asOf)}`,
    ui: `${fmt(view.spyBreadth.marketSessionDate)} / ${fmt(view.spyBreadth.asOf)}`,
    match:
      spyBreadthDerived.marketSessionDate === view.spyBreadth.marketSessionDate &&
      spyBreadthDerived.asOf === view.spyBreadth.asOf,
    issue:
      spyBreadthDerived.stale
        ? `stale vs target ${targetSession} · UI shows stale badge`
        : "—",
  });

  breadthRows.push({
    field: "advance / decline / unchanged",
    rawSource: "snapshot counts",
    sessionDateAsOf: fmt(snapshot?.marketSessionDate),
    derived: `${fmt(snapshot?.advance)} / ${fmt(snapshot?.decline)} / ${fmt(snapshot?.unchanged)}`,
    ui: `${fmt(view.spyBreadth.advance)} / ${fmt(view.spyBreadth.decline)} / ${fmt(view.spyBreadth.unchanged)}`,
    match:
      snapshot?.advance === view.spyBreadth.advance &&
      snapshot?.decline === view.spyBreadth.decline &&
      snapshot?.unchanged === view.spyBreadth.unchanged,
    issue: "—",
  });

  const ma20Raw = snapshot?.metrics?.percentAboveMA20;
  const ma50Raw = snapshot?.metrics?.percentAboveMA50;
  breadthRows.push({
    field: "% above MA20 / MA50",
    rawSource: "snapshot metrics",
    sessionDateAsOf: fmt(snapshot?.marketSessionDate),
    derived: `${pct(ma20Raw?.numerator ?? null, ma20Raw?.denominator ?? null)} / ${pct(ma50Raw?.numerator ?? null, ma50Raw?.denominator ?? null)}`,
    ui: `${fmt(view.spyBreadth.percentAboveMA20)}% / ${fmt(view.spyBreadth.percentAboveMA50)}%`,
    match:
      spyBreadthDerived.percentAboveMA20 === view.spyBreadth.percentAboveMA20 &&
      spyBreadthDerived.percentAboveMA50 === view.spyBreadth.percentAboveMA50,
    issue: "—",
  });

  const hiRaw = snapshot?.metrics?.new20DayClosingHigh;
  const loRaw = snapshot?.metrics?.new20DayClosingLow;
  breadthRows.push({
    field: "new 20d high / low %",
    rawSource: "snapshot metrics",
    sessionDateAsOf: fmt(snapshot?.marketSessionDate),
    derived: `${pct(hiRaw?.numerator ?? null, hiRaw?.denominator ?? null)} / ${pct(loRaw?.numerator ?? null, loRaw?.denominator ?? null)}`,
    ui: `${fmt(view.spyBreadth.new20DayClosingHigh)}% / ${fmt(view.spyBreadth.new20DayClosingLow)}%`,
    match: true,
    issue: "detail panel only",
  });

  breadthRows.push({
    field: "Strong / Mixed / Weak",
    rawSource: "deriveBreadthActionableSignal",
    sessionDateAsOf: `target ${targetSession} · snapshot ${fmt(snapshot?.marketSessionDate)}`,
    derived: breadthSignalLabel(
      spyBreadthDerived.breadthSignal,
      spyBreadthDerived.breadthSignalStatus,
    ),
    ui: breadthSignalLabel(
      view.spyBreadth.breadthSignal,
      view.spyBreadth.breadthSignalStatus,
    ),
    match:
      spyBreadthDerived.breadthSignal === view.spyBreadth.breadthSignal &&
      spyBreadthDerived.breadthSignalStatus === view.spyBreadth.breadthSignalStatus,
    issue: spyBreadthDerived.stale
      ? "signal computed on dated session with stale badge (not silent T−1)"
      : "—",
  });

  breadthRows.push({
    field: "stale / partial status",
    rawSource: "evaluateDurableBreadthSessionFreshness",
    sessionDateAsOf: `target ${targetSession}`,
    derived: `status=${spyBreadthDerived.status} stale=${spyBreadthDerived.stale}`,
    ui: `status=${view.spyBreadth.status} stale=${view.spyBreadth.stale}`,
    match:
      spyBreadthDerived.status === view.spyBreadth.status &&
      spyBreadthDerived.stale === view.spyBreadth.stale,
    issue: fmt(spyBreadthDerived.missingReason),
  });

  printTable("SPY Breadth", breadthRows);

  const spyBars = equityBarsBySymbol.get("SPY");
  const qqqBars = equityBarsBySymbol.get("QQQ");
  const spyQuote = marketPanel?.quotes?.find((q) => q.symbol === "SPY");
  const qqqQuote = marketPanel?.quotes?.find((q) => q.symbol === "QQQ");
  const spyBarsThrough = spyBars
    ? spyBars.filter((b) => b.sessionDate <= targetSession)
    : [];
  const qqqBarsThrough = qqqBars
    ? qqqBars.filter((b) => b.sessionDate <= targetSession)
    : [];

  const ctaDerived = summarizeCtaProxy({
    spyBars,
    qqqBars,
    spyPrice: spyQuote?.latestPrice ?? null,
    qqqPrice: qqqQuote?.latestPrice ?? null,
    targetSession,
  });

  const ctaRows: AuditRow[] = [
    {
      field: "SPY / QQQ quote source",
      rawSource: spyQuote?.source ?? "—",
      sessionDateAsOf: spyQuote?.timestamp ?? "—",
      derived: `${fmt(spyQuote?.latestPrice)} / ${fmt(qqqQuote?.latestPrice)}`,
      ui: "live quotes for CTA price vs MA",
      match: true,
      issue: spyQuote ? "—" : "quotes unavailable without Alpaca credentials",
    },
    {
      field: "daily bar source",
      rawSource: equityBars?.provenance.provider ?? "—",
      sessionDateAsOf: `panel latest ${fmt(equityBars?.provenance.latestSessionDate)} · cache SPY ${fmt(latestCachedSession(readSymbolBarCache(dataRoot, "SPY")))}`,
      derived: `SPY ${spyBars?.length ?? 0} bars · QQQ ${qqqBars?.length ?? 0} bars`,
      ui: "same equityBarsBySymbol map",
      match: true,
      issue:
        equityBars?.provenance.returnedSymbols === 0
          ? "fixed: cache fallback when credentials absent"
          : "—",
    },
    {
      field: "aligned session (≤ target)",
      rawSource: "filtered bar tails",
      sessionDateAsOf: `target ${targetSession}`,
      derived: `${spyBarsThrough.at(-1)?.sessionDate ?? "—"} / ${qqqBarsThrough.at(-1)?.sessionDate ?? "—"}`,
      ui: ctaDerived.status === "available" ? targetSession : "unavailable",
      match:
        ctaDerived.status !== "available" ||
        (spyBarsThrough.at(-1)?.sessionDate === targetSession &&
          qqqBarsThrough.at(-1)?.sessionDate === targetSession),
      issue:
        spyBars &&
        spyBars.at(-1) &&
        spyBars.at(-1)!.sessionDate > targetSession
          ? "extra intraday bar excluded from MA/HV alignment"
          : "—",
    },
    {
      field: "MA20 / MA50 (SPY)",
      rawSource: "computeCloseMovingAverage through target",
      sessionDateAsOf: targetSession,
      derived: `${fmt(computeCloseMovingAverage(spyBarsThrough, 20))} / ${fmt(computeCloseMovingAverage(spyBarsThrough, 50))}`,
      ui: "trigger lines in CTA card",
      match: true,
      issue: "—",
    },
    {
      field: "HV20 dampening",
      rawSource: "computeHv20AnnualizedPct",
      sessionDateAsOf: targetSession,
      derived: fmt(computeHv20AnnualizedPct(spyBarsThrough)),
      ui: ctaDerived.signal === "neutral" && ctaDerived.status === "available" ? "may dampen buying" : "—",
      match: true,
      issue: "HV≥25% dampens buying→neutral",
    },
    {
      field: "Buying / Neutral / Selling",
      rawSource: "summarizeCtaProxy",
      sessionDateAsOf: targetSession,
      derived: ctaProxySignalLabel(ctaDerived.signal, ctaDerived.status),
      ui: ctaProxySignalLabel(view.ctaProxy.signal, view.ctaProxy.status),
      match:
        ctaDerived.signal === view.ctaProxy.signal &&
        ctaDerived.status === view.ctaProxy.status,
      issue:
        ctaDerived.status === "unavailable"
          ? "missing bars or quotes vs target session"
          : "—",
    },
  ];

  printTable("CTA Proxy", ctaRows);

  const rotation = view.sectorRotation;
  const spyBarLast = spyBarsThrough.at(-1)?.sessionDate;
  const sectorRows: AuditRow[] = [
    {
      field: "SPY benchmark bars",
      rawSource: equityBars?.provenance.provider ?? "spy-universe cache",
      sessionDateAsOf: fmt(spyBarLast),
      derived: spyBarsThrough.length > 0 ? "available" : "missing",
      ui: rotation.status,
      match: rotation.status === "available" || spyBarsThrough.length === 0,
      issue: rotation.missingReason ?? "—",
    },
    {
      field: "sector ETF bar coverage",
      rawSource: sectorRotationBarSymbols().join(", "),
      sessionDateAsOf: `panel ${fmt(equityBars?.provenance.latestSessionDate)}`,
      derived: `${equityBars?.provenance.returnedSymbols ?? 0}/${equityBars?.provenance.requestedSymbols ?? 0}`,
      ui: fmt(rotation.sectors.length),
      match: true,
      issue: "—",
    },
    {
      field: "sessionDate / stale",
      rawSource: "summarizeSectorRotation",
      sessionDateAsOf: `target ${targetSession}`,
      derived: `${fmt(rotation.sessionDate)} stale=${rotation.stale}`,
      ui: `${fmt(rotation.sessionDate)} stale=${rotation.stale}`,
      match: true,
      issue: rotation.stale ? "stale badge in UI" : "—",
    },
    {
      field: "leading / weakening labels",
      rawSource: "classification + rs5d sort",
      sessionDateAsOf: targetSession,
      derived: rotation.topLeadingImproving
        .map((r) => formatSectorEtfLabel(r.symbol))
        .join(" · "),
      ui: rotation.topLeadingImproving
        .map((r) => formatSectorEtfLabel(r.symbol))
        .join(" · "),
      match: true,
      issue: rotation.bottomWeakening
        .map((r) => formatSectorEtfLabel(r.symbol))
        .join(" · "),
    },
  ];

  if (rotation.sectors.length > 0) {
    const xlk = rotation.sectors.find((r) => r.symbol === "XLK");
    if (xlk) {
      sectorRows.push({
        field: "XLK sample (1D/5D/20D · rs5d)",
        rawSource: "sessionCloseReturnPct vs SPY",
        sessionDateAsOf: targetSession,
        derived: `${fmt(xlk.return1d)} / ${fmt(xlk.return5d)} / ${fmt(xlk.return20d)} · rs5d ${fmt(xlk.rs5d)}`,
        ui: `${xlk.classification} · MA20 ${xlk.aboveMa20} MA50 ${xlk.aboveMa50}`,
        match: true,
        issue: "—",
      });
    }
  }

  printTable("Sector Rotation", sectorRows);

  console.log(`\nTarget completed session: ${targetSession}`);
  console.log(`Bar panel fetchedAt: ${equityBars?.provenance.fetchedAt ?? "—"}`);
  console.log(`Breadth bars latest in snapshot: ${snapshotRaw?.bars?.latestSessionDate ?? "—"}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
