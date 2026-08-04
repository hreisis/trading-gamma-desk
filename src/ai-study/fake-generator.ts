import type { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import type { AiStudyInputPacket } from "./collect-inputs";
import type { AiStudyGeneratorResult } from "./openai-generator";

export type FakeAiStudyGeneratorMode = "ok" | "provider_error";

export async function generateAiStudyWithFake(input: {
  readonly packet: AiStudyInputPacket;
  readonly mode?: FakeAiStudyGeneratorMode;
}): Promise<AiStudyGeneratorResult> {
  if (input.mode === "provider_error") {
    return { ok: false, error: "Injected provider failure" };
  }

  const regime =
    (input.packet.facts.macro?.label as string | undefined) ??
    "Macro regime unavailable — briefing uses partial inputs only.";
  const report: AiStudyNarratorRawOutput = {
    marketRegime: regime,
    mainDrivers: [
      "Dominant driver interpretation from provided macro packet.",
      "Catalyst calendar rows supplied in the input packet only.",
    ],
    keyLevelsStructure: [
      "Structure section references bounded gamma facts when present; otherwise marked unavailable.",
    ],
    upcomingRisks: [
      "Upcoming catalysts limited to those explicitly listed in the input packet.",
    ],
    scenarios: {
      bull: "Conditional path if provided macro + structure context persist without new shocks.",
      base: "Status-quo path using the supplied cross-asset and structure facts only.",
      bear: "Conditional path if catalyst or structure inputs in the packet deteriorate.",
    },
  };
  return { ok: true, report, model: "fake-ai-study" };
}
