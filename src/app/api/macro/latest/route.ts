import { NextResponse } from "next/server";
import { resolveDeskRequest } from "@/desk";
import { demoFlagFromRequest } from "@/desk/public-demo";

/**
 * Serve the latest desk view model (read-only).
 * Does not ingest, classify, or interpret.
 *
 * Query:
 * - `?source=fixture` — force fixture (local)
 * - `?source=live` — local live-only
 * - `?demo=1` — synthetic demo fixtures (same as `/demo` routes)
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const demo = demoFlagFromRequest(request);
  const view = resolveDeskRequest({
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
