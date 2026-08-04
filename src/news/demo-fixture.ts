import {
  MARKET_NEWS_PANEL_SCHEMA_VERSION,
  type MarketNewsPanel,
} from "@/contracts/market-news";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";
import demoNewsJson from "../../fixtures/news/public-demo.news.json";

export function loadSyntheticMarketNewsPanel(input: {
  readonly fetchedAt: string;
}): MarketNewsPanel {
  const fixture = demoNewsJson as MarketNewsPanel;
  return {
    ...fixture,
    fetchedAt: input.fetchedAt,
    message: PUBLIC_DEMO_BANNER,
    provider: "synthetic_demo",
    status: "synthetic_demo",
    configured: false,
  };
}
