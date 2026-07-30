import { NextResponse } from "next/server";
import { loadMacroDesk } from "@/desk";

/**
 * Serve the latest desk view model (read-only).
 * Does not ingest, classify, or interpret.
 *
 * Query:
 * - `?source=fixture` — force demo fixture (never silent when live is broken)
 * - `?source=live` — live only; empty if no drivers (no fixture)
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const preferFixture = source === "fixture";
  const liveOnly = source === "live";

  const view = loadMacroDesk({
    preferFixture,
    allowFixture: !liveOnly,
  });

  return NextResponse.json({
    status: view.status,
    source: view.source,
    sourceLabel: view.sourceLabel,
    isLiveDriver: view.isLiveDriver,
    isFixtureFallback: view.isDemo,
    isDemo: view.isDemo,
    sessionStale: view.sessionStale,
    snapshotPresent: view.snapshotPresent,
    driverPath: view.driverPath,
    pipeline: view.pipeline,
    error: view.error,
    driver: view.driver,
  });
}
