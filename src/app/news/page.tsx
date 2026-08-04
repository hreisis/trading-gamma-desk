import { MarketNewsPanel } from "@/app/components/news/MarketNewsPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadMarketNewsPanel } from "@/news";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const panel = await loadMarketNewsPanel({ publicDemo: false });

  return (
    <DeskChrome activeNav="news">
      <section className="desk-intro">
        <h1 className="desk-title">Market news</h1>
        <p className="desk-section-note">
          Recent headlines from Alpaca when configured locally. No AI
          summarization — raw headline, source, timestamp, and related symbols
          only. Public demo serves labelled synthetic fixtures.
        </p>
      </section>
      <MarketNewsPanel panel={panel} />
    </DeskChrome>
  );
}
