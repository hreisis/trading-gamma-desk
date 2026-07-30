import { MacroDesk } from "@/app/components/MacroDesk";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import { resolveDeskRequest } from "@/desk";

/** Always resolve at request time (env + query). */
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const params = await searchParams;
  const view = resolveDeskRequest({ source: params.source });
  // Public-demo + ?source=live: macro view is live_unavailable and Catalyst
  // UI is hidden here; /api/catalysts still returns synthetic_demo (documented).
  const catalystFeed =
    view.status === "live_unavailable"
      ? null
      : toPublicCatalystFeed(loadCatalystFeed());

  return <MacroDesk view={view} catalystFeed={catalystFeed} />;
}
