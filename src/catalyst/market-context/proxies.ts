/**
 * ETF proxies for event market context. Labels must stay ETF/proxy language —
 * never call UUP "DXY", TLT "10Y yield", or SPY "official S&P 500 index".
 */

export interface MarketContextProxy {
  readonly symbol: string;
  readonly instrumentLabel: string;
  readonly proxyRole: string;
}

export const MARKET_CONTEXT_PROXIES: readonly MarketContextProxy[] = [
  {
    symbol: "SPY",
    instrumentLabel: "SPY ETF (US equities proxy)",
    proxyRole: "US equities",
  },
  {
    symbol: "QQQ",
    instrumentLabel: "QQQ ETF (Nasdaq-100 / growth proxy)",
    proxyRole: "Nasdaq/growth",
  },
  {
    symbol: "IWM",
    instrumentLabel: "IWM ETF (small-cap proxy)",
    proxyRole: "Small caps",
  },
  {
    symbol: "TLT",
    instrumentLabel: "TLT ETF (long-duration Treasuries proxy)",
    proxyRole: "Long Treasuries",
  },
  {
    symbol: "UUP",
    instrumentLabel: "UUP ETF (US dollar proxy)",
    proxyRole: "US dollar",
  },
  {
    symbol: "GLD",
    instrumentLabel: "GLD ETF (gold proxy)",
    proxyRole: "Gold",
  },
] as const;

export function marketContextSymbolList(
  proxies: readonly MarketContextProxy[] = MARKET_CONTEXT_PROXIES,
): string {
  return proxies.map((p) => p.symbol).join(",");
}
