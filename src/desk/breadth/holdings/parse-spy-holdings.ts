import type {
  EtfUniverseArtifact,
  EtfUniverseConstituent,
  EtfUniverseExcludedRow,
  EtfUniverseExclusionReason,
} from "@/contracts/etf-universe-artifact";
import { EtfUniverseArtifact as EtfUniverseArtifactSchema } from "@/contracts/etf-universe-artifact";
import {
  SPY_BREADTH_CONFIG,
  SPY_HOLDINGS_SOURCE_URL,
} from "../config";

const EQUITY_TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface SpyHoldingsParseInput {
  readonly rows: readonly (readonly string[])[];
  readonly fetchedAt: string;
  readonly sourceUrl?: string;
}

function parseAsOf(rows: readonly (readonly string[])[]): string | null {
  for (const row of rows) {
    const joined = row.join(" ");
    const match = joined.match(/As of (\d{2})-([A-Za-z]{3})-(\d{4})/i);
    if (!match) continue;
    const day = match[1];
    const mon = match[2]!.toLowerCase();
    const year = match[3];
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const month = months[mon.slice(0, 3)];
    if (!month) return null;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function findHeaderIndex(rows: readonly (readonly string[])[]): number {
  const idx = rows.findIndex(
    (row) => row[0] === "Name" && row[1] === "Ticker" && row[2] === "Identifier",
  );
  if (idx < 0) throw new Error("SPY holdings: header row not found");
  return idx;
}

function parseNumber(value: string | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "-") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyTicker(
  rawSymbol: string,
): { included: true; symbol: string } | { included: false; reason: EtfUniverseExclusionReason } {
  const symbol = rawSymbol.trim();
  if (!symbol) return { included: false, reason: "non_equity_ticker" };
  if (symbol === "-") return { included: false, reason: "cash_row" };
  if (!EQUITY_TICKER_PATTERN.test(symbol)) {
    return { included: false, reason: "non_equity_ticker" };
  }
  return { included: true, symbol };
}

/** Disclaimer/footer rows: empty ticker with no position fields. */
function isIgnoredMetadataRow(
  rawSymbol: string,
  name: string,
  weight: number | null,
  shares: number | null,
): boolean {
  if (rawSymbol.trim()) return false;
  if (!name.trim()) return false;
  return weight === null && shares === null;
}

export function parseSpyHoldingsMatrix(
  input: SpyHoldingsParseInput,
): EtfUniverseArtifact {
  const headerIdx = findHeaderIndex(input.rows);
  const header = [...input.rows[headerIdx]!];
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`SPY holdings: missing column ${name}`);
    return idx;
  };
  const nameIdx = col("Name");
  const tickerIdx = col("Ticker");
  const identifierIdx = col("Identifier");
  const weightIdx = header.includes("Weight") ? col("Weight") : -1;
  const sharesIdx = header.includes("Shares Held") ? col("Shares Held") : -1;
  const sectorIdx = header.includes("Sector") ? col("Sector") : -1;

  const asOf = parseAsOf(input.rows);
  if (!asOf) throw new Error("SPY holdings: asOf date not found");

  const constituents: EtfUniverseConstituent[] = [];
  const excludedRows: EtfUniverseExcludedRow[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let holdingCandidateCount = 0;
  let ignoredMetadataRowCount = 0;
  let rawWeightSum = 0;
  let includedWeightSum = 0;
  const dataRows = input.rows.slice(headerIdx + 1);
  const sheetDataRowCount = dataRows.length;

  for (const row of dataRows) {
    const rawSymbol = (row[tickerIdx] ?? "").trim();
    const name = (row[nameIdx] ?? "").trim();
    const identifier = (row[identifierIdx] ?? "").trim() || null;
    const weight = weightIdx >= 0 ? parseNumber(row[weightIdx]) : null;
    const shares = sharesIdx >= 0 ? parseNumber(row[sharesIdx]) : null;
    const assetClass =
      sectorIdx >= 0 ? ((row[sectorIdx] ?? "").trim() || null) : null;
    if (weight !== null) rawWeightSum += weight;
    if (!name && !rawSymbol) continue;

    if (isIgnoredMetadataRow(rawSymbol, name, weight, shares)) {
      ignoredMetadataRowCount += 1;
      continue;
    }

    holdingCandidateCount += 1;

    const decision = classifyTicker(rawSymbol);
    if (!decision.included) {
      excludedRows.push({
        rawSymbol,
        name: name || rawSymbol,
        identifier,
        weight,
        shares,
        exclusionReason: decision.reason,
      });
      continue;
    }
    if (seen.has(decision.symbol)) {
      duplicateCount += 1;
      excludedRows.push({
        rawSymbol,
        name,
        identifier,
        weight,
        shares,
        exclusionReason: "duplicate_ticker",
      });
      continue;
    }
    seen.add(decision.symbol);
    if (weight !== null) includedWeightSum += weight;
    constituents.push({
      symbol: decision.symbol,
      sourceSymbol: rawSymbol,
      name,
      identifier,
      assetClass,
      weight,
      shares,
    });
  }

  return EtfUniverseArtifactSchema.parse({
    kind: "EtfUniverseArtifact",
    schemaVersion: "0.1.0",
    universeId: SPY_BREADTH_CONFIG.universeId,
    fundSymbol: SPY_BREADTH_CONFIG.fundSymbol,
    provenanceType: "official_etf_holdings",
    provider: "State Street SPDR",
    sourceUrl: input.sourceUrl ?? SPY_HOLDINGS_SOURCE_URL,
    asOf,
    fetchedAt: input.fetchedAt,
    status: "available",
    stale: false,
    sessionLag: null,
    rowCounts: {
      sheetDataRowCount,
      holdingCandidateCount,
      constituentCount: constituents.length,
      excludedHoldingCount: excludedRows.length,
      ignoredMetadataRowCount,
      duplicateCount,
      rawWeightSum,
      includedWeightSum,
    },
    excludedRows,
    constituents,
  });
}
