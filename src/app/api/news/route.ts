import { NextResponse } from "next/server";
import { loadMarketNewsPanel } from "@/news";
import { demoFlagFromRequest } from "@/desk/public-demo";

export const dynamic = "force-dynamic";

/** Recent market headlines — Alpaca when configured; demo via ?demo=1. */
export async function GET(request: Request) {
  const publicDemo = demoFlagFromRequest(request);
  const panel = await loadMarketNewsPanel({
    publicDemo: publicDemo ? true : false,
  });
  return NextResponse.json(panel);
}
