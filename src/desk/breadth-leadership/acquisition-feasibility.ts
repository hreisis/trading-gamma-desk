/**
 * V2-3B2 feasibility audit conclusions — official ETF holdings + Alpaca bars.
 * Live probes: scripts/breadth-feasibility-smoke.ts (2026-08-07).
 */

export const BREADTH_ACQUISITION_FEASIBILITY_VERSION = "0.2.0" as const;

export type FeasibilityVerdict = "READY" | "PARTIAL" | "BLOCKED";

export interface HoldingsSourceAudit {
  readonly fundSymbol: string;
  readonly provider: string;
  readonly sourceUrl: string;
  readonly format: "xlsx" | "json" | "html_js" | "retired";
  readonly loginRequired: boolean;
  readonly programmatic: "confirmed" | "partial" | "blocked";
  readonly asOf: string | null;
  readonly constituentCount: number | null;
  readonly provenance: "etf_holdings_official";
  readonly notes: readonly string[];
}

export const HOLDINGS_SOURCE_AUDITS: readonly HoldingsSourceAudit[] = [
  {
    fundSymbol: "SPY",
    provider: "State Street SPDR",
    sourceUrl:
      "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx",
    format: "xlsx",
    loginRequired: false,
    programmatic: "confirmed",
    asOf: "2026-08-05",
    constituentCount: 504,
    provenance: "etf_holdings_official",
    notes: [
      "Daily XLSX over HTTPS 200; no CSV endpoint (CSV paths 404).",
      "Header row: Name, Ticker, Identifier, Weight, Shares Held.",
      "Filter cash row Ticker='-' and non-equity identifiers (e.g. 2602335D).",
      "BRK.B uses dot format — Alpaca-compatible without normalization.",
      "Not a licensed S&P 500 constituent file — ETF holdings exposure universe.",
    ],
  },
  {
    fundSymbol: "QQQ",
    provider: "Invesco DNG API",
    sourceUrl:
      "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&interval=monthly&productType=ETF&expand=holdings",
    format: "json",
    loginRequired: false,
    programmatic: "confirmed",
    asOf: "2026-08-05",
    constituentCount: 107,
    provenance: "etf_holdings_official",
    notes: [
      "Legacy CSV download URL retired (HTTP 301 → homepage).",
      "loadType=initial returns top-10 only — must omit or use expand=holdings for full set.",
      "effectiveDate / totalNumberOfHoldings in JSON; all rows securityTypeCode=COM.",
      "Nasdaq-100 index license not required — QQQ fund holdings only.",
    ],
  },
  {
    fundSymbol: "SPHB",
    provider: "Invesco DNG API (CUSIP id)",
    sourceUrl:
      "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46138E354/holdings/fund?idType=cusip&interval=monthly&productType=ETF&expand=holdings",
    format: "json",
    loginRequired: false,
    programmatic: "confirmed",
    asOf: "2026-08-05",
    constituentCount: 111,
    provenance: "etf_holdings_official",
    notes: [
      "idType=ticker returns HTTP 500 — use CUSIP 46138E354.",
      "BRK/B slash format — normalize to BRK.B for Alpaca.",
      "High-beta exposure via fund holdings, not a factor screener.",
    ],
  },
  {
    fundSymbol: "SMH",
    provider: "VanEck",
    sourceUrl: "https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/",
    format: "html_js",
    loginRequired: false,
    programmatic: "blocked",
    asOf: "2026-08-04",
    constituentCount: 26,
    provenance: "etf_holdings_official",
    notes: [
      "Holdings table rendered client-side; headless fetch returned generic shell without tickers.",
      "Guessed XLS/ashx URLs return 404 or redirect loops.",
      "Manual browser Download XLS exists on product page — automation path not confirmed.",
      "26 names incl. TSM, ASML ADRs and -USD CASH- rows.",
    ],
  },
] as const;

export const BREADTH_ACQUISITION_VERDICT: FeasibilityVerdict = "PARTIAL";

export const BREADTH_ACQUISITION_BLOCKERS = [
  "SMH: no confirmed stable programmatic official holdings artifact in this audit.",
  "Invesco: API quirks (expand=holdings, SPHB CUSIP-only, BRK/B normalization).",
  "52-week high/low: requires ~400 calendar-day bar history per symbol (90d smoke returned 36–61 bars).",
] as const;

export const BREADTH_ACQUISITION_OPERATIONAL_NOTES = [
  "Fetch holdings daily; persist versioned artifacts under data/universes/{FUND}/{asOf}.json with fetchedAt.",
  "Live breadth unavailable if today's holdings fetch fails — no silent reuse of unlabeled prior universe.",
  "Holdings TTL: same-day asOf required for Live; stale universe → breadth_internals unavailable.",
  "Alpaca: multi-symbol GET /v2/stocks/bars works; 503 SPY symbols / 6 pages / ~3s on IEX.",
  "Dedupe symbols across universes before bar fetch; cache bars by symbol+session.",
  "Use adjustment=split; map BRK/B→BRK.B, BF/B→BF.B before Alpaca.",
  "PIT: store daily universe snapshots; compute breadth with that day's list only (no survivorship forward-fill).",
] as const;
