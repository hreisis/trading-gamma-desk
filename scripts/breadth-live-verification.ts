/**
 * V2-3B3 final live verification — aggregated output only.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BreadthInternalsSnapshot } from "@/contracts/breadth-internals";
import { loadMarketInputSnapshot } from "@/desk/build-market-input-snapshot";
import { loadSpyUniverse, fetchSpyHoldingsFromOfficial } from "@/desk/breadth/universe/load-spy-universe";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import { defaultSessionCalendar } from "@/macro/calendar";

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

function priorCount(bars: { sessionDate: string }[], target: string, n: number): number {
  return bars.filter((b) => b.sessionDate < target).slice(-n).length;
}

async function main(): Promise<void> {
  const snapshot = await loadMarketInputSnapshot({ publicDemo: false });
  const breadthField = snapshot.inputs.find((row) => row.key === "breadth_internals");
  const breadth = breadthField?.value as BreadthInternalsSnapshot | null;

  const fetchedAt = new Date().toISOString();
  const universeResult = await loadSpyUniverse({
    fetchedAt,
    targetMarketSessionDate: snapshot.targetMarketSessionDate,
    dataRoot: "data",
    allowPersistedFallback: true,
  });
  const universe = universeResult.artifact;

  let panel = null as Awaited<ReturnType<typeof loadAlpacaDailyBarPanel>> | null;
  let recomputed = null as ReturnType<typeof computeSpyBreadthInternals> | null;
  let eligibilityAudit: Record<string, unknown> = {};

  if (universe) {
    panel = await loadAlpacaDailyBarPanel({
      symbols: universe.constituents.map((c) => c.symbol),
      dataRoot: "data",
      bootstrap: false,
    });
    recomputed = computeSpyBreadthInternals({
      universe,
      targetMarketSessionDate: snapshot.targetMarketSessionDate,
      asOf: fetchedAt,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: panel.provenance,
    });

    const target = snapshot.targetMarketSessionDate;
    const prev = defaultSessionCalendar.previousSession(target);
    let smokeMa20 = 0;
    let breadthMa20 = 0;
    let minSessions = Number.POSITIVE_INFINITY;
    const lowHistory: Array<{ symbol: string; total: number; prior20: number }> = [];

    for (const c of universe.constituents) {
      const series = panel.seriesBySymbol.get(c.symbol);
      const bars = (series?.bars ?? []).filter((b) => b.sessionDate <= target);
      const total = bars.length;
      if (total > 0) minSessions = Math.min(minSessions, total);
      const prior20 = priorCount(bars, target, 20);
      if (total >= 21) smokeMa20 += 1;
      if (prior20 >= 20 && bars.some((b) => b.sessionDate === target)) breadthMa20 += 1;
      if (total < 51) lowHistory.push({ symbol: c.symbol, total, prior20 });
    }

    eligibilityAudit = {
      targetMarketSessionDate: target,
      previousSession: prev,
      minTotalSessionsInCache: minSessions === Number.POSITIVE_INFINITY ? 0 : minSessions,
      smokeStyleMa20Eligible: smokeMa20,
      breadthStyleMa20Eligible: breadthMa20,
      lowHistorySample: lowHistory
        .filter((r) => r.total <= 51)
        .sort((a, b) => a.total - b.total)
        .slice(0, 10),
      explanation:
        "400d smoke used total bars.length>=21; breadth uses 20 prior closes before target plus target bar on session date. minSessions is total cached bars, not prior-only count.",
    };
  }

  let holdingsAudit: Record<string, unknown> = { error: "universe unavailable" };
  try {
    const artifact = await fetchSpyHoldingsFromOfficial(fetchedAt);
    const duplicates = artifact.excludedRows.filter(
      (r) => r.exclusionReason === "duplicate_ticker",
    );
    holdingsAudit = {
      xlsxStructure: {
        preambleRowsBeforeHeader:
          "Name/Ticker/Identifier header row excluded from sheetDataRowCount",
        rowCounts: artifact.rowCounts,
      },
      rowCounts: artifact.rowCounts,
      duplicatePolicy:
        "First occurrence by file order wins; later rows with same normalized symbol → duplicate_ticker excluded",
      duplicateTickers: duplicates.map((r) => r.rawSymbol),
      excludedHoldings: artifact.excludedRows.map((r) => ({
        sourceSymbol: r.rawSymbol,
        name: r.name,
        identifier: r.identifier,
        weight: r.weight,
        exclusionReason: r.exclusionReason,
        shares: r.shares,
      })),
    };
  } catch (error: unknown) {
    holdingsAudit = {
      error: error instanceof Error ? error.message : String(error),
      fallback: universe
        ? {
            excludedRows: universe.excludedRows,
            rowCounts: universe.rowCounts,
          }
        : null,
    };
  }

  const fieldStatuses = Object.fromEntries(
    snapshot.inputs.map((row) => [row.key, row.status]),
  );

  console.log(
    JSON.stringify(
      {
        liveVerification: {
          targetMarketSessionDate: snapshot.targetMarketSessionDate,
          generatedAt: snapshot.generatedAt,
          universe: universe
            ? {
                asOf: universe.asOf,
                sessionLag: universe.sessionLag,
                stale: universe.stale,
                source: universeResult.source,
                rowCounts: universe.rowCounts,
              }
            : null,
          bars: panel?.provenance
            ? {
                latestSessionDate: panel.provenance.latestSessionDate,
                priceFeed: panel.provenance.priceFeed,
                isConsolidated: panel.provenance.isConsolidated,
                coverage: panel.provenance.coverage,
                returnedSymbols: panel.provenance.returnedSymbols,
              }
            : null,
          breadthInternals: breadth
            ? {
                fieldStatus: breadthField?.status,
                snapshotStatus: breadth.status,
                stale: breadth.stale,
                missingReason: breadth.missingReason,
                metrics: breadth.metrics,
                coverage: breadth.coverage,
                advance: breadth.advance,
                decline: breadth.decline,
                unchanged: breadth.unchanged,
              }
            : {
                fieldStatus: breadthField?.status,
                missingReason: breadthField?.missingReason,
              },
          recomputedMetrics: recomputed?.metrics ?? null,
          summary: snapshot.summary,
          fieldStatuses,
          missingCountExplanation: {
            current: snapshot.summary.missingCount,
            stillMissing: ["leadership_rotation", "vix_term_structure", "credit_stress"],
            movedToUnavailable: [
              "breadth_internals (wired, live load attempted)",
              "event_gate (wired; unavailable when calendar stale/missing)",
            ],
            priorMissing5:
              "breadth + leadership + vix_term + credit + event_gate(all missing)",
            priorMissing4: "after event_gate became unavailable not missing",
            priorMissing3: "after breadth_internals became unavailable not missing",
          },
        },
        eligibilityAudit,
        holdingsAudit,
        persistenceAudit: {
          localPaths: [
            "data/universes/SPY/{asOf}.json",
            "data/universes/SPY/latest.json",
            "data/bars/spy-universe/{symbol}.json",
          ],
          capability: "local-ready only",
          deploymentBlocker:
            "Vercel serverless has no durable writable data/ — requires external object storage or build-time artifacts",
          adapterBoundary:
            "persist.ts / cache.ts are local filesystem adapters; no Blob/DB wired in V2-3B3",
          writeFailureDegradation:
            "universe fetch fail → persisted latest with sessionLag; breadth unavailable if no universe or bars",
        },
      },
      null,
      2,
    ),
  );
}

void main();
