import { MacroDesk } from "@/app/components/MacroDesk";
import { loadAiStudyBriefing } from "@/ai-study";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { loadBoundedGammaDeskView, resolveDeskRequest } from "@/desk";
import { parseDeskPanelId } from "@/app/components/desk/desk-panel-types";

export const dynamic = "force-dynamic";

export default async function DemoHomePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; panel?: string }>;
}) {
  const params = await searchParams;
  const view = resolveDeskRequest({
    source: params.source,
    demoPath: true,
    publicDemo: true,
  });
  const catalystFeed =
    view.status === "live_unavailable"
      ? null
      : toPublicCatalystFeed(loadCatalystFeed({}, { publicDemo: true }));

  const gammaViews = (["SPY", "QQQ"] as const).map((symbol) =>
    loadBoundedGammaDeskView({
      symbol,
      forceFixture: params.gamma === "fixture",
      publicDemo: true,
    }),
  );

  const [marketPanel, aiBriefing] = await Promise.all([
    loadAlpacaMarketPanel({ publicDemo: true }),
    loadAiStudyBriefing({ publicDemo: true }),
  ]);

  return (
    <MacroDesk
      view={view}
      catalystFeed={catalystFeed}
      gammaViews={gammaViews}
      marketPanel={marketPanel}
      aiBriefing={aiBriefing}
      initialPanel={parseDeskPanelId(params.panel)}
      demoMode
    />
  );
}
