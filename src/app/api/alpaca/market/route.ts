import { NextResponse } from "next/server";
import { loadAlpacaMarketPanel } from "@/alpaca";

export const dynamic = "force-dynamic";

/** Recent market quotes for portfolio watchlist — Alpaca when configured. */
export async function GET() {
  const panel = await loadAlpacaMarketPanel();
  return NextResponse.json(panel);
}
