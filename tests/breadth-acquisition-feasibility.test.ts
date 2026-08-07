import { describe, expect, it } from "vitest";
import { EtfUniverseArtifact } from "@/contracts/etf-universe-artifact";
import {
  BREADTH_ACQUISITION_VERDICT,
  HOLDINGS_SOURCE_AUDITS,
} from "@/desk/breadth-leadership/acquisition-feasibility";

describe("V2-3B2 acquisition feasibility", () => {
  it("records PARTIAL verdict with SMH as the remaining holdings blocker", () => {
    expect(BREADTH_ACQUISITION_VERDICT).toBe("PARTIAL");
    const smh = HOLDINGS_SOURCE_AUDITS.find((row) => row.fundSymbol === "SMH");
    expect(smh?.programmatic).toBe("blocked");
    const spy = HOLDINGS_SOURCE_AUDITS.find((row) => row.fundSymbol === "SPY");
    expect(spy?.programmatic).toBe("confirmed");
  });

  it("parses the versioned universe artifact contract shape", () => {
    const artifact = EtfUniverseArtifact.parse({
      kind: "EtfUniverseArtifact",
      schemaVersion: "0.1.0",
      universeId: "spy_etf_holdings",
      fundSymbol: "SPY",
      asOf: "2026-08-05",
      fetchedAt: "2026-08-07T01:00:00.000Z",
      provider: "State Street SPDR",
      sourceUrl:
        "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx",
      provenanceType: "official_etf_holdings",
      status: "available",
      stale: false,
      sessionLag: 0,
      rowCounts: {
        sheetDataRowCount: 1,
        holdingCandidateCount: 1,
        constituentCount: 1,
        excludedHoldingCount: 0,
        ignoredMetadataRowCount: 0,
        duplicateCount: 0,
        rawWeightSum: 1,
        includedWeightSum: 1,
      },
      excludedRows: [],
      constituents: [
        {
          symbol: "AAPL",
          sourceSymbol: "AAPL",
          name: "APPLE INC",
          identifier: "037833100",
          assetClass: null,
          weight: 1,
          shares: 1,
        },
      ],
    });
    expect(artifact.provenanceType).toBe("official_etf_holdings");
  });
});
