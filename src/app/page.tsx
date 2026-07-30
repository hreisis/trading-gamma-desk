import { MacroDesk } from "@/app/components/MacroDesk";
import { loadMacroDesk } from "@/desk";

/** Always read local artifacts at request time when present. */
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const params = await searchParams;
  const preferFixture = params.source === "fixture";
  const liveOnly = params.source === "live";

  const view = loadMacroDesk({
    preferFixture,
    allowFixture: !liveOnly,
  });

  return <MacroDesk view={view} />;
}
