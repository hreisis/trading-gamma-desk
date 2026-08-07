/**
 * Coverage gates calibrated from V2-3B2 live smoke (503 SPY symbols, IEX 90d).
 * MA50 requires 50 prior sessions; 400d bootstrap improves eligible counts.
 */
export const SPY_BREADTH_CONFIG = {
  universeId: "spy_etf_holdings",
  fundSymbol: "SPY",
  maxUniverseSessionLag: 1,
  /** Minimum sessions for each eligibility class */
  minSessionsPricePair: 2,
  minSessionsMa20: 21,
  minSessionsMa50: 51,
  minSessionsHighLow20: 21,
  /** Production coverage thresholds (included constituents) */
  thresholdPricePair: 0.9,
  thresholdMa20: 0.85,
  thresholdMa50: 0.8,
  thresholdHighLow20: 0.85,
  /** Below this, breadth is unavailable rather than partial */
  hardFloorPricePair: 0.7,
  alpacaBatchSize: 100,
  incrementalTradingDays: 5,
  bootstrapCalendarDays: 400,
  barAdjustment: "split" as const,
} as const;

export const SPY_HOLDINGS_SOURCE_URL =
  "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx" as const;
