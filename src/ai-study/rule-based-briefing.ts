import type {
  AiStudyClaim,
  AiStudyNarratorRawOutput,
} from "@/contracts/ai-study-briefing";
import type { AiStudyInputPacket } from "./collect-inputs";
import { buildAiStudyEvidenceCorpus } from "./evidence-corpus";

export const RULE_BASED_AI_STUDY_MODEL = "ai_study_rule_v1";

function claim(text: string, evidenceIds: string[]): AiStudyClaim {
  return { text, evidenceIds };
}

/**
 * Deterministic AI Study body from the collected input packet — no LLM, no new math.
 */
export function buildRuleBasedAiStudyReport(
  packet: AiStudyInputPacket,
): AiStudyNarratorRawOutput {
  const regimeLabel =
    (packet.facts.macro?.label as string | undefined) ??
    "Macro regime unavailable — briefing uses partial inputs only.";
  const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);
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

  return {
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
      claim(
        "Upcoming catalysts limited to those explicitly listed in the input packet.",
        [catalystEvidenceId],
      ),
    ],
    scenarios: {
      bull: claim(
        "Conditional path if provided macro + structure context persist without new shocks.",
        [macroLabelId, gammaSpotId],
      ),
      base: claim(
        "Status-quo path using the supplied cross-asset and structure facts only.",
        [macroLabelId],
      ),
      bear: claim(
        "Conditional path if catalyst or structure inputs in the packet deteriorate.",
        [catalystEvidenceId],
      ),
    },
  };
}
