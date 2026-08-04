import { NextResponse } from "next/server";
import { loadAlpacaMarketPanel } from "@/alpaca";
import { demoFlagFromRequest } from "@/desk/public-demo";

export const dynamic = "force-dynamic";

/** Recent market quotes for watchlist — Alpaca when configured. */
export async function GET(request: Request) {
  const publicDemo = demoFlagFromRequest(request);
  const panel = await loadAlpacaMarketPanel({
    publicDemo: publicDemo ? true : false,
  });
  return NextResponse.json(panel);
}
