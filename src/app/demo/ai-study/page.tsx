import { AiStudyPanel } from "@/app/components/ai-study/AiStudyPanel";
import { DeskChrome } from "@/app/components/DeskChrome";
import { loadAiStudyBriefing } from "@/ai-study";

export const dynamic = "force-dynamic";

export default async function DemoAiStudyPage() {
  const briefing = await loadAiStudyBriefing({ publicDemo: true });

  return (
    <DeskChrome activeNav="ai-study" demoMode>
      <section className="desk-intro">
        <h1 className="desk-title">AI Study briefing (demo)</h1>
        <p className="desk-section-note">
          Synthetic demo fixtures only — illustrative, not market data.
        </p>
      </section>
      <AiStudyPanel briefing={briefing} />
    </DeskChrome>
  );
}
