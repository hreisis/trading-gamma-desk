import type { AiStudyBriefing } from "@/contracts/ai-study-briefing";
import { AiStudyPanel } from "../../ai-study/AiStudyPanel";

export function AiStudyWorkspacePanel({
  briefing,
}: {
  briefing: AiStudyBriefing;
}) {
  return (
    <div className="workspace-panel" data-testid="workspace-ai-study">
      <AiStudyPanel briefing={briefing} />
    </div>
  );
}
