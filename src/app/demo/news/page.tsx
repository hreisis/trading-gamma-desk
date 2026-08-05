import { MarketNewsPanel } from "@/app/components/news/MarketNewsPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadMarketNewsPanel } from "@/news";

export const dynamic = "force-dynamic";

export default async function DemoNewsPage() {
  const panel = await loadMarketNewsPanel({ publicDemo: true });

  return (
    <DeskChrome demoMode>
      <section className="desk-intro">
        <h1 className="desk-title">Market news (demo)</h1>
        <p className="desk-section-note">
          Synthetic headline fixtures — not a live wire.
        </p>
      </section>
      <MarketNewsPanel panel={panel} />
    </DeskChrome>
  );
}
