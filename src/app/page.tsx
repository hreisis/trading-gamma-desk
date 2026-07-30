import { MacroDesk } from "@/app/components/MacroDesk";
import { loadCatalystFeed } from "@/catalyst";
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
  const catalystFeed =
    view.status === "live_unavailable" ? null : loadCatalystFeed();

  return <MacroDesk view={view} catalystFeed={catalystFeed} />;
}
