import { NextResponse } from "next/server";
import { resolveLastCompletedMarketSessionDate } from "@/ai-study/session";
import {
  ManualGammaSaveRequest,
  saveManualGammaSnapshot,
  type ManualGammaSnapshot,
} from "@/desk/manual-gamma";
import { resolveRuntimeJsonStore } from "@/desk/runtime-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ManualGammaSaveRequest.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid manual gamma input.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const marketSessionDate = resolveLastCompletedMarketSessionDate(now);
  const snapshot: ManualGammaSnapshot = {
    kind: "ManualGammaSnapshot",
    schemaVersion: "0.1.0",
    marketSessionDate,
    savedAt: now.toISOString(),
    source: parsed.data.source,
    priceAsOfEt: parsed.data.priceAsOfEt,
    oiAsOf: parsed.data.oiAsOf,
    notes: parsed.data.notes,
    symbols: parsed.data.symbols,
  };

  const store = resolveRuntimeJsonStore(process.env);
  const saved = await saveManualGammaSnapshot(store, snapshot);
  if (!saved) {
    return NextResponse.json(
      { ok: false, error: "Could not persist manual gamma snapshot." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, snapshot });
}
