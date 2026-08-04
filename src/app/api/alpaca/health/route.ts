import { NextResponse } from "next/server";
import { loadAlpacaHealth } from "@/alpaca";

export const dynamic = "force-dynamic";

/** Alpaca connectivity and credential health — server-side only. */
export async function GET() {
  const health = await loadAlpacaHealth();
  return NextResponse.json(health);
}
