import { MacroDesk } from "@/app/components/MacroDesk";
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

  return <MacroDesk view={view} />;
}
