import { DecisionSurface } from "@/app/components/DecisionSurface";
import {
  loadDecisionSurfaceAsync,
  parseDecisionSurfaceDateParam,
} from "@/desk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DecidePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionDate = parseDecisionSurfaceDateParam(params.date);
  const view = await loadDecisionSurfaceAsync({ sessionDate, publicDemo: false });

  return <DecisionSurface view={view} />;
}
