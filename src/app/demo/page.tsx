import { MacroDesk } from "@/app/components/MacroDesk";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { loadBoundedGammaDeskView, resolveDeskRequest } from "@/desk";

export const dynamic = "force-dynamic";

export default async function DemoHomePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string }>;
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

  const gammaView = loadBoundedGammaDeskView({
    symbol: "SPY",
    forceFixture: params.gamma === "fixture",
    publicDemo: true,
  });

  return (
    <MacroDesk
      view={view}
      catalystFeed={catalystFeed}
      gammaView={gammaView}
      demoMode
    />
  );
}
