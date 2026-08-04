import {
  AI_STUDY_BRIEFING_SCHEMA_VERSION,
  AI_STUDY_METHODOLOGY_ID,
  AI_STUDY_METHODOLOGY_VERSION,
  type AiStudyBriefing,
} from "@/contracts/ai-study-briefing";
import { PUBLIC_DEMO_BANNER } from "@/desk/public-demo";
import demoBriefingJson from "../../fixtures/ai-study/public-demo.briefing.json";
import { AI_STUDY_TIMEZONE, resolveAiStudyMarketStatus } from "./session";

export function loadSyntheticAiStudyBriefing(input: {
  readonly generatedAt: string;
  readonly now?: Date;
}): AiStudyBriefing {
  const demo = demoBriefingJson as AiStudyBriefing;
  const now = input.now ?? new Date(input.generatedAt);
  return {
    ...demo,
    kind: "AiStudyBriefing",
    schemaVersion: AI_STUDY_BRIEFING_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    mode: "current",
    marketStatus: resolveAiStudyMarketStatus(now),
    timezone: AI_STUDY_TIMEZONE,
    status: "synthetic_demo",
    message: PUBLIC_DEMO_BANNER,
    provider: "synthetic_demo",
    model: null,
    methodologyId: AI_STUDY_METHODOLOGY_ID,
    methodologyVersion: AI_STUDY_METHODOLOGY_VERSION,
  };
}
