import { MacroDesk } from "@/app/components/MacroDesk";
import { toPublicCatalystFeed } from "@/catalyst";
import {
  loadBoundedGammaDeskViewAsync,
  loadCatalystFeedAsync,
  resolveDeskRequestAsync,
} from "@/desk";

/** Always resolve at request time (env + query). */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; gamma?: string; demo?: string }>;
}) {
  const params = await searchParams;
  const view = await resolveDeskRequestAsync({
    source: params.source,
    demoQuery: params.demo,
    publicDemo: false,
  });
  const catalystFeed =
    view.status === "live_unavailable"
      ? null
      : toPublicCatalystFeed(
          await loadCatalystFeedAsync({}, { publicDemo: view.isPublicDemo }),
        );

  const gammaViews = await Promise.all(
    (["SPY", "QQQ"] as const).map((symbol) =>
      loadBoundedGammaDeskViewAsync({
        symbol,
        forceFixture: params.gamma === "fixture",
        publicDemo: view.isPublicDemo,
      }),
    ),
  );

  return (
    <MacroDesk view={view} catalystFeed={catalystFeed} gammaViews={gammaViews} />
  );
}
