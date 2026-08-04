import { AiStudyPanel } from "@/app/components/ai-study/AiStudyPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadAiStudyBriefing } from "@/ai-study";

export const dynamic = "force-dynamic";

export default async function AiStudyPage() {
  const briefing = await loadAiStudyBriefing();

  return (
    <DeskChrome activeNav="ai-study">
      <section className="desk-intro">
        <h1 className="desk-title">AI Study briefing</h1>
        <p className="desk-section-note">
          One concise market briefing synthesized from macro, catalysts,
          structure, Alpaca quotes, and historical study context when
          available. Missing or fixture-backed inputs are labeled — nothing is
          invented server-side beyond the LLM narrative over supplied facts.
        </p>
      </section>
      <AiStudyPanel briefing={briefing} />
    </DeskChrome>
  );
}
