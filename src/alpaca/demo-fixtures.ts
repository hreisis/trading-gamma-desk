import {
  ALPACA_MARKET_PANEL_SCHEMA_VERSION,
  type AlpacaMarketPanel,
} from "@/contracts/alpaca-market";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";
import { DEFAULT_ALPACA_SYMBOLS } from "./config";

/** Illustrative prices for the public portfolio demo — not market data. */
export function loadSyntheticAlpacaMarketPanel(input: {
  readonly fetchedAt: string;
  readonly watchlist?: readonly string[];
}): AlpacaMarketPanel {
  const watchlist = [...new Set([...(input.watchlist ?? DEFAULT_ALPACA_SYMBOLS)])];
  const demoTimestamp = "2026-07-29T20:00:00.000Z";

  const demoQuotes = {
    SPY: { price: 548.25, change: 0.42 },
    QQQ: { price: 478.1, change: 0.55 },
    "BTC/USD": { price: 67250.5, change: -1.12 },
    IWM: { price: 218.4, change: 0.18 },
    TLT: { price: 92.15, change: -0.31 },
  } as const;

  return {
    kind: "AlpacaMarketPanel",
    schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
    fetchedAt: input.fetchedAt,
    configured: false,
    status: "synthetic_demo",
    message: PUBLIC_DEMO_BANNER,
    health: {
      kind: "AlpacaHealthStatus",
      schemaVersion: ALPACA_MARKET_PANEL_SCHEMA_VERSION,
      checkedAt: input.fetchedAt,
      configured: false,
      credentialState: "missing",
      reachable: false,
      message: "Public demo uses synthetic market fixtures — Alpaca not called",
      isPublicDemo: true,
      source: "synthetic_demo",
    },
    watchlist,
    quotes: watchlist.map((symbol) => {
      const demo = demoQuotes[symbol as keyof typeof demoQuotes];
      if (!demo) {
        return {
          symbol,
          latestPrice: 100,
          dailyChangePct: 0,
          timestamp: demoTimestamp,
          source: "synthetic_demo" as const,
          status: "available" as const,
        };
      }
      return {
        symbol,
        latestPrice: demo.price,
        dailyChangePct: demo.change,
        timestamp: demoTimestamp,
        source: "synthetic_demo" as const,
        status: "available" as const,
      };
    }),
  };
}
