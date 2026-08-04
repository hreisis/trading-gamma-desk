import { NextResponse } from "next/server";
import { resolveDeskRequestAsync } from "@/desk";
import { demoFlagFromRequest } from "@/desk/public-demo";

/**
 * Serve the latest desk view model (read-only).
 * Production serverless hosts refresh macro drivers via TIINGO_TOKEN when
 * local `data/drivers/` is absent.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const demo = demoFlagFromRequest(request);
  const view = await resolveDeskRequestAsync({
    source,
    demoQuery: url.searchParams.get("demo"),
    demoPath: demo && url.pathname.startsWith("/demo"),
    publicDemo: demo ? true : false,
  });

  return NextResponse.json({
    status: view.status,
    source: view.source,
    sourceLabel: view.sourceLabel,
    isLiveDriver: view.isLiveDriver,
    isFixtureFallback: view.isDemo,
    isDemo: view.isDemo,
    isPublicDemo: view.isPublicDemo,
    sessionStale: view.sessionStale,
    snapshotPresent: view.snapshotPresent,
    driverPath: view.driverPath,
    pipeline: view.pipeline,
    error: view.error,
    driver: view.driver,
  });
}
