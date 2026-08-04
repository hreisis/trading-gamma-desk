import { DecisionSurface } from "@/app/components/DecisionSurface";
import {
  loadDecisionSurface,
  parseDecisionSurfaceDateParam,
} from "@/desk";

export const dynamic = "force-dynamic";

export default async function DecidePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionDate = parseDecisionSurfaceDateParam(params.date);
  const view = loadDecisionSurface({ sessionDate, publicDemo: false });

  return <DecisionSurface view={view} />;
}
