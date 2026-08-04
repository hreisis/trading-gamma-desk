import { NextResponse } from "next/server";
import { loadAiStudyBriefing } from "@/ai-study";

export const dynamic = "force-dynamic";

/** AI Study briefing JSON — server-side generation only. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const historicalDate = url.searchParams.get("date")?.trim();
  const briefing = await loadAiStudyBriefing({
    sessionDate: historicalDate ?? null,
  });
  return NextResponse.json(briefing);
}
