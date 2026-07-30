import { NextResponse } from "next/server";
import { deskSourceLabel, loadMacroDesk } from "@/desk";

/**
 * Serve the latest precomputed DominantDriver.
 * Does not ingest, classify, or interpret — filesystem read + Zod parse only.
 *
 * `source` is always `"local_driver"` (live) or `"fixture"` (fallback).
 * Clients must not treat fixture payloads as the live session.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const payload = loadMacroDesk();
  const isLiveDriver = payload.source === "local_driver";
  return NextResponse.json({
    source: payload.source,
    sourceLabel: deskSourceLabel(payload.source),
    isLiveDriver,
    isFixtureFallback: !isLiveDriver,
    snapshotPresent: payload.snapshotPresent,
    driverPath: payload.driverPath,
    driver: payload.driver,
  });
}
