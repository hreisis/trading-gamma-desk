import { z } from "zod";
import { IsoDate, IsoDateTime } from "./common";

export const ETF_UNIVERSE_ARTIFACT_SCHEMA_VERSION = "0.1.0" as const;

export const EtfUniverseProvenanceType = z.literal("official_etf_holdings");

export const EtfUniverseArtifactStatus = z.enum([
  "available",
  "partial",
  "unavailable",
]);

export const EtfUniverseExclusionReason = z.enum([
  "cash_row",
  "non_equity_ticker",
  "duplicate_ticker",
]);

export const EtfUniverseExcludedRow = z.object({
  rawSymbol: z.string(),
  name: z.string(),
  identifier: z.string().nullable(),
  weight: z.number().nullable(),
  shares: z.number().nullable(),
  exclusionReason: EtfUniverseExclusionReason,
});

export const EtfUniverseConstituent = z.object({
  symbol: z.string().min(1),
  sourceSymbol: z.string().min(1),
  name: z.string().min(1),
  identifier: z.string().nullable(),
  assetClass: z.string().nullable(),
  weight: z.number().nullable(),
  shares: z.number().nullable(),
});

export const EtfUniverseRowCounts = z
  .object({
    /** Rows in sheet 1 after the Name/Ticker/Identifier header. */
    sheetDataRowCount: z.number().int().nonnegative(),
    /** Rows that represent a holding position (equity, cash, CVR, duplicate). */
    holdingCandidateCount: z.number().int().nonnegative(),
    constituentCount: z.number().int().nonnegative(),
    /** cash / non-equity / duplicate exclusions from holding candidates. */
    excludedHoldingCount: z.number().int().nonnegative(),
    /** Disclaimer, footer, and other non-holding sheet rows (not in excludedRows). */
    ignoredMetadataRowCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    rawWeightSum: z.number().nullable(),
    includedWeightSum: z.number().nullable(),
  })
  .superRefine((counts, ctx) => {
    if (
      counts.sheetDataRowCount !==
      counts.holdingCandidateCount + counts.ignoredMetadataRowCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sheetDataRowCount"],
        message:
          "sheetDataRowCount must equal holdingCandidateCount + ignoredMetadataRowCount",
      });
    }
    if (
      counts.holdingCandidateCount !==
      counts.constituentCount + counts.excludedHoldingCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["holdingCandidateCount"],
        message:
          "holdingCandidateCount must equal constituentCount + excludedHoldingCount",
      });
    }
  });

export const EtfUniverseArtifact = z.object({
  kind: z.literal("EtfUniverseArtifact"),
  schemaVersion: z.literal(ETF_UNIVERSE_ARTIFACT_SCHEMA_VERSION),
  universeId: z.string().min(1),
  fundSymbol: z.string().min(1),
  provenanceType: EtfUniverseProvenanceType,
  provider: z.string().min(1),
  sourceUrl: z.string().url(),
  asOf: IsoDate,
  fetchedAt: IsoDateTime,
  status: EtfUniverseArtifactStatus,
  stale: z.boolean(),
  sessionLag: z.number().int().nonnegative().nullable(),
  rowCounts: EtfUniverseRowCounts,
  excludedRows: z.array(EtfUniverseExcludedRow),
  constituents: z.array(EtfUniverseConstituent),
});

export type EtfUniverseArtifact = z.infer<typeof EtfUniverseArtifact>;
export type EtfUniverseConstituent = z.infer<typeof EtfUniverseConstituent>;
export type EtfUniverseExcludedRow = z.infer<typeof EtfUniverseExcludedRow>;
export type EtfUniverseExclusionReason = z.infer<typeof EtfUniverseExclusionReason>;
