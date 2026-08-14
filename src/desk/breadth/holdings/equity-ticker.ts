import type { EtfUniverseExclusionReason } from "@/contracts/etf-universe-artifact";

export const EQUITY_TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function classifyEquityTicker(
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
