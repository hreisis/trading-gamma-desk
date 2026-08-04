import { NextResponse } from "next/server";
import { loadAiStudyBriefing } from "@/ai-study";

export const dynamic = "force-dynamic";

/** AI Study briefing JSON — server-side generation only. */
export async function GET() {
  const briefing = await loadAiStudyBriefing();
  return NextResponse.json(briefing);
}
