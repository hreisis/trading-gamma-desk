import type { AiStudyGeneratorResult } from "./openai-generator";
import type { AiStudyInputPacket } from "./collect-inputs";
import { buildAiStudyUsage } from "./usage";
import {
  buildRuleBasedAiStudyReport,
  RULE_BASED_AI_STUDY_MODEL,
} from "./rule-based-briefing";

export type FakeAiStudyGeneratorMode = "ok" | "provider_error";

export async function generateAiStudyWithFake(input: {
  readonly packet: AiStudyInputPacket;
  readonly mode?: FakeAiStudyGeneratorMode;
}): Promise<AiStudyGeneratorResult> {
  if (input.mode === "provider_error") {
    return { ok: false, error: "Injected provider failure", usage: null };
  }

  const report = buildRuleBasedAiStudyReport(input.packet);
  return {
    ok: true,
    report,
    model: "fake-ai-study",
    usage: buildAiStudyUsage({
      model: "fake-ai-study",
      inputTokens: 120,
      outputTokens: 180,
      retryCount: 0,
    }),
  };
}

export { buildRuleBasedAiStudyReport, RULE_BASED_AI_STUDY_MODEL };
