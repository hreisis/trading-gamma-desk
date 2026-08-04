import { AiStudyPanel } from "@/app/components/ai-study/AiStudyPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadAiStudyBriefing } from "@/ai-study";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AiStudyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const historicalDate = params.date?.trim();
  const briefing = await loadAiStudyBriefing({
    sessionDate: historicalDate ?? null,
    publicDemo: false,
  });

  return (
    <DeskChrome activeNav="ai-study">
      <section className="desk-intro">
        <h1 className="desk-title">AI Study briefing</h1>
        <p className="desk-section-note">
          {briefing.mode === "historical" ? (
            <>
              Historical replay for session {briefing.sessionDate}. Alpaca quotes
              and catalysts may still reflect live snapshots — see provenance
              below.
            </>
          ) : (
            <>
              Current session briefing anchored to today&apos;s US market date
              (America/New_York) with live Alpaca quotes. Cached macro, gamma,
              and historical study inputs show their own session/as-of when they
              lag today.
            </>
          )}
        </p>
      </section>
      <AiStudyPanel briefing={briefing} historicalDate={historicalDate ?? null} />
    </DeskChrome>
  );
}
