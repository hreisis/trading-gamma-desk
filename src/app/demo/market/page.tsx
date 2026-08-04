import { AlpacaMarketPanel } from "@/app/components/alpaca/AlpacaMarketPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadAlpacaMarketPanel } from "@/alpaca";

export const dynamic = "force-dynamic";

export default async function DemoMarketPage() {
  const panel = await loadAlpacaMarketPanel({ publicDemo: true });

  return (
    <DeskChrome activeNav="market" demoMode>
      <section className="desk-intro">
        <h1 className="desk-title">Market data (demo)</h1>
        <p className="desk-section-note">
          Synthetic quote fixtures — not live Alpaca data.
        </p>
      </section>
      <AlpacaMarketPanel panel={panel} />
    </DeskChrome>
  );
}
