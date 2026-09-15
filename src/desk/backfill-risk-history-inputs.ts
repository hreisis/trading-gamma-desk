/**
 * Backfill dated SPY breadth snapshots and macro drivers for Risk V1 replay.
 * Uses only local historical bars/universe files through each target session.
 * Does not fetch live data, does not update the live breadth latest pointer,
 * and does not change Risk/Gamma scoring.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ALL_SYMBOLS, RegimeSignatureConfig, type MacroSymbol } from "@/contracts";
import { BreadthInternalsSnapshot as BreadthInternalsSnapshotSchema } from "@/contracts/breadth-internals";
import type { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import { EtfUniverseArtifact as EtfUniverseArtifactSchema } from "@/contracts/etf-universe-artifact";
import { defaultSessionCalendar } from "@/macro/calendar";
import { readSymbolBarCache } from "@/desk/breadth/bars/cache";
import type { SymbolBarSeries } from "@/desk/breadth/bars/types";
import { SPY_BREADTH_CONFIG } from "@/desk/breadth/config";
import { computeSpyBreadthInternals } from "@/desk/breadth/compute/breadth";
import { createFilesystemBreadthSnapshotStore } from "@/desk/breadth/store";
import { tradingSessionLag } from "@/desk/breadth/universe/session-lag";
import { universeDir } from "@/desk/breadth/universe/persist";
import { assembleSnapshot } from "@/ingest/assemble";
import { readBars, writeSnapshot } from "@/ingest/store";
import type { SymbolSeries } from "@/ingest/types";
import { interpretAndWriteDriver } from "@/pipeline/interpret-and-write";

export const RISK_HISTORY_BACKFILL_START = "2026-07-27";
export const RISK_HISTORY_BACKFILL_END = "2026-08-24";

const DEFAULT_SIGNATURE =
  "fixtures/macro/regime-signature.sig-2026-07-01.json";

export interface BackfillSkip {
  readonly sessionDate: string;
  readonly reason: string;
}

export interface BackfillRiskHistoryResult {
  readonly breadthWritten: readonly string[];
  readonly breadthAlreadyPresent: readonly string[];
  readonly breadthSkipped: readonly BackfillSkip[];
  readonly macroWritten: readonly string[];
  readonly macroSkipped: readonly BackfillSkip[];
}

export interface BackfillRiskHistoryOptions {
  readonly dataRoot: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly signaturePath?: string;
}

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

export function tradingSessionsInRange(
  startDate: string,
  endDate: string,
): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    if (defaultSessionCalendar.isSession(cursor)) dates.push(cursor);
    cursor = addOneDay(cursor);
  }
  return dates;
}

function sessionCloseUtc(sessionDate: string): string {
  return `${sessionDate}T20:00:00.000Z`;
}

function coerceSpyUniverseArtifact(raw: unknown): EtfUniverseArtifact | null {
  const direct = EtfUniverseArtifactSchema.safeParse(raw);
  if (direct.success) return direct.data;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const counts = row.rowCounts;
  if (!counts || typeof counts !== "object") return null;
  const c = counts as Record<string, unknown>;
  const constituents = Array.isArray(row.constituents) ? row.constituents : [];
  const excludedRowsRaw = Array.isArray(row.excludedRows) ? row.excludedRows : [];
  const allowedReasons = new Set(["cash_row", "non_equity_ticker", "duplicate_ticker"]);
  const excludedRows = excludedRowsRaw.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      allowedReasons.has((item as { exclusionReason?: string }).exclusionReason ?? ""),
  );
  const constituentCount = constituents.length;
  const excludedHoldingCount = excludedRows.length;
  const holdingCandidateCount = constituentCount + excludedHoldingCount;
  const ignoredMetadataRowCount = 0;
  const sheetDataRowCount = holdingCandidateCount;
  const coerced = {
    ...row,
    excludedRows,
    rowCounts: {
      sheetDataRowCount,
      holdingCandidateCount,
      constituentCount,
      excludedHoldingCount,
      ignoredMetadataRowCount,
      duplicateCount: typeof c.duplicateCount === "number" ? c.duplicateCount : 0,
      rawWeightSum: typeof c.rawWeightSum === "number" ? c.rawWeightSum : null,
      includedWeightSum:
        typeof c.includedWeightSum === "number" ? c.includedWeightSum : null,
    },
  };
  const parsed = EtfUniverseArtifactSchema.safeParse(coerced);
  return parsed.success ? parsed.data : null;
}

function loadDatedSpyUniverses(dataRoot: string): EtfUniverseArtifact[] {
  const dir = universeDir(dataRoot, "SPY");
  if (!existsSync(dir)) return [];
  const rows: EtfUniverseArtifact[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "latest.json" || !name.endsWith(".json")) continue;
    const parsed = coerceSpyUniverseArtifact(
      JSON.parse(readFileSync(join(dir, name), "utf8")),
    );
    if (parsed) rows.push(parsed);
  }
  return rows.sort((left, right) => left.asOf.localeCompare(right.asOf));
}

function universeThroughSession(
  universes: readonly EtfUniverseArtifact[],
  sessionDate: string,
): EtfUniverseArtifact | null {
  const eligible = universes.filter((row) => row.asOf <= sessionDate);
  const picked = eligible.at(-1);
  if (!picked) return null;
  const lag = tradingSessionLag(picked.asOf, sessionDate);
  // Last holdings file on or before the session is not look-ahead. Sparse
  // as-of dates would otherwise fail the live lag gate and never publish.
  return EtfUniverseArtifactSchema.parse({
    ...picked,
    sessionLag: lag,
    stale: false,
    status: "available",
  });
}

function truncateSeries(
  series: SymbolBarSeries,
  sessionDate: string,
): SymbolBarSeries {
  return {
    ...series,
    bars: series.bars.filter((bar) => bar.sessionDate <= sessionDate),
  };
}

function loadConstituentPanel(
  dataRoot: string,
  symbols: readonly string[],
): Map<string, SymbolBarSeries> {
  const seriesBySymbol = new Map<string, SymbolBarSeries>();
  for (const symbol of symbols) {
    const cached = readSymbolBarCache(dataRoot, symbol);
    if (cached && cached.bars.length > 0) {
      seriesBySymbol.set(symbol, cached);
    }
  }
  return seriesBySymbol;
}

function panelThroughSession(
  full: ReadonlyMap<string, SymbolBarSeries>,
  symbols: readonly string[],
  sessionDate: string,
): {
  readonly seriesBySymbol: Map<string, SymbolBarSeries>;
  readonly returnedSymbols: number;
  readonly failedSymbols: string[];
  readonly latestSessionDate: string | null;
} {
  const seriesBySymbol = new Map<string, SymbolBarSeries>();
  const failedSymbols: string[] = [];
  let latestSessionDate: string | null = null;
  for (const symbol of symbols) {
    const fullSeries = full.get(symbol);
    if (!fullSeries) {
      failedSymbols.push(symbol);
      continue;
    }
    const truncated = truncateSeries(fullSeries, sessionDate);
    if (truncated.bars.length === 0) {
      failedSymbols.push(symbol);
      continue;
    }
    seriesBySymbol.set(symbol, truncated);
    const last = truncated.bars.at(-1)?.sessionDate ?? null;
    if (last && (!latestSessionDate || last > latestSessionDate)) {
      latestSessionDate = last;
    }
  }
  return {
    seriesBySymbol,
    returnedSymbols: seriesBySymbol.size,
    failedSymbols,
    latestSessionDate,
  };
}

async function backfillBreadth(options: {
  readonly dataRoot: string;
  readonly sessions: readonly string[];
}): Promise<{
  readonly written: string[];
  readonly alreadyPresent: string[];
  readonly skipped: BackfillSkip[];
}> {
  const written: string[] = [];
  const alreadyPresent: string[] = [];
  const skipped: BackfillSkip[] = [];
  const universes = loadDatedSpyUniverses(options.dataRoot);
  const store = createFilesystemBreadthSnapshotStore({
    dataRoot: options.dataRoot,
    universeId: SPY_BREADTH_CONFIG.universeId,
    fundSymbol: SPY_BREADTH_CONFIG.fundSymbol,
  });

  const constituentSymbols = [
    ...new Set(universes.flatMap((row) => row.constituents.map((c) => c.symbol))),
  ];
  const fullPanel = loadConstituentPanel(options.dataRoot, constituentSymbols);

  for (const sessionDate of options.sessions) {
    const existing = await store.readSnapshotBySessionDate(sessionDate);
    if (existing && existing.schemaVersion === "0.2.0" && existing.status !== "unavailable") {
      alreadyPresent.push(sessionDate);
      continue;
    }

    const universe = universeThroughSession(universes, sessionDate);
    if (!universe) {
      skipped.push({
        sessionDate,
        reason: "no SPY holdings artifact with asOf ≤ session (would be look-ahead)",
      });
      continue;
    }

    const symbols = universe.constituents.map((row) => row.symbol);
    const panel = panelThroughSession(fullPanel, symbols, sessionDate);
    if (panel.returnedSymbols === 0) {
      skipped.push({
        sessionDate,
        reason: "no local constituent bars through session",
      });
      continue;
    }

    const asOf = sessionCloseUtc(sessionDate);
    const snapshot = computeSpyBreadthInternals({
      universe,
      targetMarketSessionDate: sessionDate,
      asOf,
      seriesBySymbol: panel.seriesBySymbol,
      barsProvenance: {
        provider: "alpaca",
        priceFeed: "iex",
        isConsolidated: false,
        adjustment: "split",
        requestedSymbols: symbols.length,
        returnedSymbols: panel.returnedSymbols,
        coverage:
          symbols.length === 0 ? 0 : panel.returnedSymbols / symbols.length,
        pages: 0,
        fetchedAt: asOf,
        latestSessionDate: panel.latestSessionDate,
        failedSymbols: panel.failedSymbols,
      },
    });

    const validated = BreadthInternalsSnapshotSchema.parse(snapshot);
    if (validated.status === "unavailable") {
      const pairEligible = validated.metrics.advanceDecline.eligibleCount;
      const included = universe.constituents.length;
      skipped.push({
        sessionDate,
        reason:
          pairEligible / included < SPY_BREADTH_CONFIG.hardFloorPricePair
            ? `local constituent bars cover ${pairEligible}/${included} names on session (need ≥${Math.round(SPY_BREADTH_CONFIG.hardFloorPricePair * 100)}%); cache mostly ends 2026-08-11`
            : (validated.missingReason ?? "breadth compute status unavailable"),
      });
      continue;
    }

    await store.writeVersioned(validated);
    written.push(sessionDate);
  }

  return { written, alreadyPresent, skipped };
}

function truncateMacroSeries(
  series: SymbolSeries,
  sessionDate: string,
): SymbolSeries {
  return {
    ...series,
    bars: series.bars.filter((bar) => bar.sessionDate <= sessionDate),
  };
}

function backfillMacro(options: {
  readonly dataRoot: string;
  readonly sessions: readonly string[];
  readonly signaturePath: string;
}): {
  readonly written: string[];
  readonly skipped: BackfillSkip[];
} {
  const written: string[] = [];
  const skipped: BackfillSkip[] = [];
  const config = RegimeSignatureConfig.parse(
    JSON.parse(readFileSync(options.signaturePath, "utf8")),
  );

  const fullSeries: SymbolSeries[] = [];
  try {
    for (const symbol of ALL_SYMBOLS) {
      fullSeries.push(readBars(symbol as MacroSymbol, options.dataRoot));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const sessionDate of options.sessions) {
      skipped.push({ sessionDate, reason: message });
    }
    return { written, skipped };
  }

  for (const sessionDate of options.sessions) {
    const truncated = fullSeries.map((series) =>
      truncateMacroSeries(series, sessionDate),
    );
    const missingSeries = truncated
      .filter((series) => series.bars.length === 0)
      .map((series) => series.symbol);
    if (missingSeries.length > 0) {
      skipped.push({
        sessionDate,
        reason: `no observations through session for ${missingSeries.join(", ")}`,
      });
      continue;
    }

    const us2y = truncated.find((series) => series.symbol === "US2Y");
    const us10y = truncated.find((series) => series.symbol === "US10Y");
    const has2y = us2y?.bars.some((bar) => bar.sessionDate === sessionDate);
    const has10y = us10y?.bars.some((bar) => bar.sessionDate === sessionDate);
    if (!has2y || !has10y) {
      skipped.push({
        sessionDate,
        reason: "US2Y/US10Y print not available on session",
      });
      continue;
    }

    try {
      const snapshot = assembleSnapshot(truncated, config, {
        marketSessionDate: sessionDate,
        generatedAt: sessionCloseUtc(sessionDate),
      });
      const path = join(options.dataRoot, "snapshots", `${sessionDate}.json`);
      if (existsSync(path)) rmSync(path);
      writeSnapshot(sessionDate, snapshot, options.dataRoot);
      interpretAndWriteDriver({
        dataRoot: options.dataRoot,
        session: sessionDate,
        updatePipelineStatus: false,
      });
      written.push(sessionDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({ sessionDate, reason: message });
    }
  }

  return { written, skipped };
}

export async function backfillRiskHistoryInputs(
  options: BackfillRiskHistoryOptions,
): Promise<BackfillRiskHistoryResult> {
  const startDate = options.startDate ?? RISK_HISTORY_BACKFILL_START;
  const endDate = options.endDate ?? RISK_HISTORY_BACKFILL_END;
  const sessions = tradingSessionsInRange(startDate, endDate);
  const breadth = await backfillBreadth({
    dataRoot: options.dataRoot,
    sessions,
  });
  const macro = backfillMacro({
    dataRoot: options.dataRoot,
    sessions,
    signaturePath: options.signaturePath ?? DEFAULT_SIGNATURE,
  });
  return {
    breadthWritten: breadth.written,
    breadthAlreadyPresent: breadth.alreadyPresent,
    breadthSkipped: breadth.skipped,
    macroWritten: macro.written,
    macroSkipped: macro.skipped,
  };
}
