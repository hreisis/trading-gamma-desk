import type { AiStudyNarratorRawOutput } from "@/contracts/ai-study-briefing";
import type { AiStudyInputPacket } from "./collect-inputs";
import type { AiStudyGeneratorResult } from "./openai-generator";
import { buildAiStudyEvidenceCorpus } from "./evidence-corpus";
import { buildAiStudyUsage } from "./usage";

export type FakeAiStudyGeneratorMode = "ok" | "provider_error";

function claim(text: string, evidenceIds: string[]) {
  return { text, evidenceIds };
}

export async function generateAiStudyWithFake(input: {
  readonly packet: AiStudyInputPacket;
  readonly mode?: FakeAiStudyGeneratorMode;
}): Promise<AiStudyGeneratorResult> {
  if (input.mode === "provider_error") {
    return { ok: false, error: "Injected provider failure", usage: null };
  }

  const regimeLabel =
    (input.packet.facts.macro?.label as string | undefined) ??
    "Macro regime unavailable — briefing uses partial inputs only.";
  const evidence = buildAiStudyEvidenceCorpus(
    input.packet.facts,
    input.packet.inputs,
  );
  const catalystEvidenceId =
    evidence.find(
      (entry) =>
        entry.id.startsWith("catalyst.") && entry.id.endsWith(".headline"),
    )?.id ?? "input.catalysts.status";
  const pickId = (id: string, fallback: string) =>
    evidence.some((entry) => entry.id === id) ? id : fallback;
  const macroLabelId = pickId("macro.label", "input.macro.status");
  const macroInterpId = pickId("macro.interpretation", macroLabelId);
  const gammaSpotId = pickId("gamma.spot", "input.gamma_structure.status");
  const report: AiStudyNarratorRawOutput = {
    marketRegime: claim(regimeLabel, [macroLabelId]),
    mainDrivers: [
      claim("Dominant driver interpretation from provided macro packet.", [
        macroInterpId,
      ]),
      claim("Catalyst calendar rows supplied in the input packet only.", [
        catalystEvidenceId,
      ]),
    ],
    keyLevelsStructure: [
      claim(
        "Structure section references bounded gamma facts when present; otherwise marked unavailable.",
        [gammaSpotId],
      ),
    ],
    upcomingRisks: [
      claim("Upcoming catalysts limited to those explicitly listed in the input packet.", [
        catalystEvidenceId,
      ]),
    ],
    scenarios: {
      bull: claim(
        "Conditional path if provided macro + structure context persist without new shocks.",
        [macroLabelId, gammaSpotId],
      ),
      base: claim("Status-quo path using the supplied cross-asset and structure facts only.", [
        macroLabelId,
      ]),
      bear: claim(
        "Conditional path if catalyst or structure inputs in the packet deteriorate.",
        [catalystEvidenceId],
      ),
    },
  };
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
