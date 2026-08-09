import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/desk/cron/verify-cron-secret";
import { produceDailySpyBreadth } from "@/desk/breadth/produce-daily-spy-breadth";
import {
  breadthProducerHttpStatus,
  logBreadthProducerResult,
} from "@/desk/breadth/producer-http";
import { resolveBreadthSnapshotStoreFromEnv } from "@/desk/breadth/store/create-store";

/** SPY breadth daily producer — Vercel Cron only; not for browser or public polling. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = verifyCronSecret(request, process.env);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const storeResolution = resolveBreadthSnapshotStoreFromEnv(process.env);
  if (!storeResolution.ok) {
    return NextResponse.json(
      {
        status: "failed",
        reason: "storage_unavailable",
        detail: storeResolution.message,
      },
      { status: 503 },
    );
  }

  const result = await produceDailySpyBreadth({
    store: storeResolution.store,
    env: process.env,
  });

  logBreadthProducerResult(result);

  const status = breadthProducerHttpStatus(result);

  if (result.status === "published") {
    return NextResponse.json(
      {
        status: result.status,
        marketSessionDate: result.marketSessionDate,
        snapshotIdentity: result.snapshotIdentity,
        publishedAt: result.publishedAt,
      },
      { status },
    );
  }

  return NextResponse.json(
    {
      status: result.status,
      reason: result.reason,
      marketSessionDate: result.marketSessionDate,
      detail: result.detail,
    },
    { status },
  );
}
