import { AlpacaMarketPanel } from "@/app/components/alpaca/AlpacaMarketPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadAlpacaMarketPanel } from "@/alpaca";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const panel = await loadAlpacaMarketPanel();

  return (
    <DeskChrome activeNav="market">
      <section className="desk-intro">
        <h1 className="desk-title">Portfolio market data</h1>
        <p className="desk-section-note">
          Recent quotes from Alpaca when configured locally. This surface never
          falls back to Tiingo or desk fixtures — missing credentials show an
          explicit unavailable state.
        </p>
      </section>
      <AlpacaMarketPanel panel={panel} />
    </DeskChrome>
  );
}
