import { NextResponse } from "next/server";
import { loadAiStudyBriefing } from "@/ai-study";
import { demoFlagFromRequest } from "@/desk/public-demo";

export const dynamic = "force-dynamic";

/** AI Study briefing JSON — server-side generation only. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const historicalDate = url.searchParams.get("date")?.trim();
  const publicDemo = demoFlagFromRequest(request);
  const briefing = await loadAiStudyBriefing({
    sessionDate: historicalDate ?? null,
    publicDemo: publicDemo ? true : false,
  });
  return NextResponse.json(briefing);
}
