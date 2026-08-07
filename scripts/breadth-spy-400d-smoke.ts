/**
 * V2-3B3 bootstrap smoke — 400 calendar-day SPY universe bar coverage.
 * Aggregated stdout only; no credentials or raw bars printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPY_BREADTH_CONFIG } from "@/desk/breadth/config";
import { loadAlpacaDailyBarPanel } from "@/desk/breadth/bars/alpaca-panel";
import { loadSpyUniverse } from "@/desk/breadth/universe/load-spy-universe";
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function main(): Promise<void> {
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  const universeResult = await loadSpyUniverse({
    fetchedAt,
    targetMarketSessionDate: new Date().toISOString().slice(0, 10),
    dataRoot: "data",
    allowPersistedFallback: true,
  });
  const universe = universeResult.artifact;
  if (!universe) {
    throw new Error(universeResult.error ?? "SPY universe unavailable");
  }
  const symbols = universe.constituents.map((row) => row.symbol);
  const panel = await loadAlpacaDailyBarPanel({
    symbols,
    bootstrap: true,
    dataRoot: "data",
  });

  const sessionCounts: number[] = [];
  let pairEligible = 0;
  let ma20Eligible = 0;
  let ma50Eligible = 0;
  let hl20Eligible = 0;
  let sessions252Eligible = 0;
  const missing: string[] = [];
  const recentIpo: string[] = [];

  for (const symbol of symbols) {
    const series = panel.seriesBySymbol.get(symbol);
    const count = series?.bars.length ?? 0;
    if (count === 0) {
      missing.push(symbol);
      continue;
    }
    sessionCounts.push(count);
    if (count >= 2) pairEligible += 1;
    if (count >= 21) ma20Eligible += 1;
    if (count >= 51) ma50Eligible += 1;
    if (count >= 21) hl20Eligible += 1;
    if (count >= 252) sessions252Eligible += 1;
    if (count < 51) recentIpo.push(symbol);
  }

  const included = symbols.length;
  const targetSession =
    panel.provenance.latestSessionDate ??
    defaultSessionCalendar.previousSession(
      new Date().toISOString().slice(0, 10),
    );

  console.log(
    JSON.stringify(
      {
        generatedAt: fetchedAt,
        elapsedMs: Date.now() - started,
        universe: {
          asOf: universe.asOf,
          includedCount: universe.rowCounts.constituentCount,
          excludedHoldingCount: universe.rowCounts.excludedHoldingCount,
        },
        alpaca: {
          priceFeed: panel.provenance.priceFeed,
          isConsolidated: panel.provenance.isConsolidated,
          pages: panel.provenance.pages,
          requestedSymbols: panel.provenance.requestedSymbols,
          returnedSymbols: panel.provenance.returnedSymbols,
          coverage: panel.provenance.coverage,
          failedSymbols: panel.provenance.failedSymbols.slice(0, 20),
          failedSymbolCount: panel.provenance.failedSymbols.length,
          latestSessionDate: panel.provenance.latestSessionDate,
        },
        sessionCounts: {
          min: sessionCounts.length ? Math.min(...sessionCounts) : 0,
          median: median(sessionCounts),
          max: sessionCounts.length ? Math.max(...sessionCounts) : 0,
        },
        eligibility: {
          pair: {
            count: pairEligible,
            coverage: included ? pairEligible / included : 0,
          },
          ma20: {
            count: ma20Eligible,
            coverage: included ? ma20Eligible / included : 0,
          },
          ma50: {
            count: ma50Eligible,
            coverage: included ? ma50Eligible / included : 0,
          },
          highLow20: {
            count: hl20Eligible,
            coverage: included ? hl20Eligible / included : 0,
          },
          sessions252Feasibility: {
            count: sessions252Eligible,
            coverage: included ? sessions252Eligible / included : 0,
          },
        },
        anomalies: {
          missingSymbols: missing.slice(0, 20),
          missingCount: missing.length,
          lowHistorySymbols: recentIpo.slice(0, 20),
          lowHistoryCount: recentIpo.length,
        },
        thresholds: SPY_BREADTH_CONFIG,
        targetSession,
      },
      null,
      2,
    ),
  );
}

void main();
