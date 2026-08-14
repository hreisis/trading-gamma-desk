import type {
  EtfUniverseArtifact,
  EtfUniverseConstituent,
  EtfUniverseExcludedRow,
} from "@/contracts/etf-universe-artifact";
import { EtfUniverseArtifact as EtfUniverseArtifactSchema } from "@/contracts/etf-universe-artifact";
import {
  QQQ_BREADTH_CONFIG,
  QQQ_HOLDINGS_SOURCE_URL,
} from "../config";
import { classifyEquityTicker } from "./equity-ticker";

const INCLUDED_SECURITY_TYPES = new Set(["COM", "ADR", "DRNY"]);

export interface InvescoQqqHoldingRow {
  readonly ticker?: string;
  readonly issuerName?: string;
  readonly units?: number;
  readonly percentageOfTotalNetAssets?: number;
  readonly securityTypeCode?: string;
  readonly cusip?: string | null;
}

export interface InvescoQqqHoldingsPayload {
  readonly effectiveDate?: string;
  readonly totalNumberOfHoldings?: number;
  readonly holdings?: readonly InvescoQqqHoldingRow[];
}

export interface QqqHoldingsParseInput {
  readonly payload: InvescoQqqHoldingsPayload;
  readonly fetchedAt: string;
  readonly sourceUrl?: string;
}

function parseInvescoAsOf(effectiveDate: string | undefined): string | null {
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return null;
  }
  return effectiveDate;
}

export function parseQqqHoldingsPayload(
  input: QqqHoldingsParseInput,
): EtfUniverseArtifact {
  const holdings = input.payload.holdings ?? [];
  const asOf = parseInvescoAsOf(input.payload.effectiveDate);
  if (!asOf) {
    throw new Error("QQQ holdings: effectiveDate not found or invalid");
  }

  const constituents: EtfUniverseConstituent[] = [];
  const excludedRows: EtfUniverseExcludedRow[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let holdingCandidateCount = 0;
  let ignoredMetadataRowCount = 0;
  let rawWeightSum = 0;
  let includedWeightSum = 0;

  for (const row of holdings) {
    const rawSymbol = (row.ticker ?? "").trim();
    const name = (row.issuerName ?? "").trim();
    const weight = row.percentageOfTotalNetAssets ?? null;
    const shares = row.units ?? null;
    const securityType = (row.securityTypeCode ?? "").trim();

    if (!rawSymbol && !name) {
      ignoredMetadataRowCount += 1;
      continue;
    }

    if (!rawSymbol || !securityType || !INCLUDED_SECURITY_TYPES.has(securityType)) {
      holdingCandidateCount += 1;
      const exclusionReason =
        securityType === "CURR" ||
        securityType === "CURRCOL" ||
        !rawSymbol ||
        rawSymbol === "-"
          ? "cash_row"
          : "non_equity_ticker";
      if (rawSymbol || name) {
        excludedRows.push({
          rawSymbol: rawSymbol || name,
          name: name || rawSymbol,
          identifier: row.cusip ?? null,
          weight,
          shares,
          exclusionReason,
        });
      } else {
        ignoredMetadataRowCount += 1;
      }
      continue;
    }

    holdingCandidateCount += 1;
    if (weight !== null) rawWeightSum += weight;

    const classified = classifyEquityTicker(rawSymbol);
    if (!classified.included) {
      excludedRows.push({
        rawSymbol,
        name,
        identifier: row.cusip ?? null,
        weight,
        shares,
        exclusionReason: classified.reason,
      });
      continue;
    }

    const symbol = classified.symbol;
    if (seen.has(symbol)) {
      duplicateCount += 1;
      excludedRows.push({
        rawSymbol,
        name,
        identifier: row.cusip ?? null,
        weight,
        shares,
        exclusionReason: "duplicate_ticker",
      });
      continue;
    }
    seen.add(symbol);
    if (weight !== null) includedWeightSum += weight;

    constituents.push({
      symbol,
      sourceSymbol: rawSymbol,
      name: name || symbol,
      identifier: row.cusip ?? null,
      assetClass: row.securityTypeCode ?? null,
      weight,
      shares,
    });
  }

  const sheetDataRowCount = holdings.length;
  const constituentCount = constituents.length;
  const excludedHoldingCount = excludedRows.length;

  return EtfUniverseArtifactSchema.parse({
    kind: "EtfUniverseArtifact",
    schemaVersion: "0.1.0",
    universeId: QQQ_BREADTH_CONFIG.universeId,
    fundSymbol: QQQ_BREADTH_CONFIG.fundSymbol,
    provenanceType: "official_etf_holdings",
    provider: "Invesco QQQ",
    sourceUrl: input.sourceUrl ?? QQQ_HOLDINGS_SOURCE_URL,
    asOf,
    fetchedAt: input.fetchedAt,
    status: constituentCount > 0 ? "available" : "unavailable",
    stale: false,
    sessionLag: null,
    rowCounts: {
      sheetDataRowCount,
      holdingCandidateCount,
      constituentCount,
      excludedHoldingCount,
      ignoredMetadataRowCount,
      duplicateCount,
      rawWeightSum,
      includedWeightSum,
    },
    excludedRows,
    constituents,
  });
}
