import { NextResponse } from "next/server";
import { resolveDeskRequest } from "@/desk";

/**
 * Serve the latest desk view model (read-only).
 * Does not ingest, classify, or interpret.
 *
 * Query:
 * - `?source=fixture` — force fixture (local); public demo already fixture-only
 * - `?source=live` — local live-only; in public demo → live_unavailable
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const view = resolveDeskRequest({ source });

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
