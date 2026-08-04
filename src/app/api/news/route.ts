import { NextResponse } from "next/server";
import { loadMarketNewsPanel } from "@/news";

export const dynamic = "force-dynamic";

/** Recent market headlines — Alpaca when configured, synthetic on public demo. */
export async function GET() {
  const panel = await loadMarketNewsPanel();
  return NextResponse.json(panel);
}
