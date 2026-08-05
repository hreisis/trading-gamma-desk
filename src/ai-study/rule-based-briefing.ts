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

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Deterministic AI Study body from the collected input packet — no LLM, no new math.
 */
export function buildRuleBasedAiStudyReport(
  packet: AiStudyInputPacket,
): AiStudyNarratorRawOutput {
  const macro = packet.facts.macro;
  const gamma = packet.facts.gammaStructure;
  const catalysts = packet.facts.catalysts;
  const evidence = buildAiStudyEvidenceCorpus(packet.facts, packet.inputs);

  const pickId = (id: string, fallback: string) =>
    evidence.some((entry) => entry.id === id) ? id : fallback;

  const macroLabelId = pickId("macro.label", "input.macro.status");
  const macroInterpId = pickId("macro.interpretation", macroLabelId);
  const macroRegimeId = pickId("macro.primaryRegime", macroLabelId);
  const gammaSpotId = pickId("gamma.spot", "input.gamma_structure.status");
  const gammaRegimeId = pickId("gamma.gammaRegime", gammaSpotId);
  const gammaInterpId = pickId(
    "gamma.interpretationSummary",
    gammaRegimeId,
  );
  const catalystEvidenceId =
    evidence.find(
      (entry) =>
        entry.id.startsWith("catalyst.") && entry.id.endsWith(".headline"),
    )?.id ?? "input.catalysts.status";

  const macroLabel = asString(macro?.label);
  const macroInterp = asString(macro?.interpretation);
  const gammaInterp = asString(
    gamma?.interpretationSummary ??
      (gamma?.structureV2 as Record<string, unknown> | undefined)
        ?.interpretationSummary,
  );
  const gammaRegime = asString(gamma?.gammaRegime);
  const gammaSpot = asString(gamma?.spot);

  const regimeText = macroLabel
    ? `${macroLabel} — desk macro driver for the cached session.`
    : gammaInterp
      ? `Structure context: ${gammaInterp}`
      : gammaRegime && gammaSpot
        ? `Bounded gamma ${gammaRegime} with spot ${gammaSpot}; macro driver not aligned to today's session.`
        : "Partial desk inputs — macro and bounded gamma may lag the current session.";

  const mainDrivers: AiStudyClaim[] = [];
  if (macroInterp) {
    mainDrivers.push(
      claim(`Macro interpretation: ${macroInterp}`, [macroInterpId]),
    );
  } else if (macroLabel) {
    mainDrivers.push(claim(`Dominant driver: ${macroLabel}.`, [macroLabelId]));
  }
  if (gammaInterp) {
    mainDrivers.push(
      claim(`Bounded structure: ${gammaInterp}`, [gammaInterpId, gammaSpotId]),
    );
  } else if (gammaRegime) {
    mainDrivers.push(
      claim(`Gamma regime ${gammaRegime} on the bounded sample.`, [
        gammaRegimeId,
        gammaSpotId,
      ]),
    );
  }
  if (mainDrivers.length === 0) {
    mainDrivers.push(
      claim("Desk macro and bounded gamma inputs are limited for this session.", [
        macroLabelId,
        gammaSpotId,
      ]),
    );
  }

  const keyLevelsStructure: AiStudyClaim[] = [];
  if (gammaSpot) {
    keyLevelsStructure.push(
      claim(`Bounded spot reference ${gammaSpot}.`, [gammaSpotId]),
    );
  }
  const callWall = gamma?.boundedCallWall as
    | { strike?: number; status?: string }
    | undefined;
  const putWall = gamma?.boundedPutWall as
    | { strike?: number; status?: string }
    | undefined;
  if (callWall?.strike) {
    keyLevelsStructure.push(
      claim(`Bounded call wall strike ${callWall.strike}.`, [
        pickId("gamma.boundedCallWall", gammaSpotId),
      ]),
    );
  }
  if (putWall?.strike) {
    keyLevelsStructure.push(
      claim(`Bounded put wall strike ${putWall.strike}.`, [
        pickId("gamma.boundedPutWall", gammaSpotId),
      ]),
    );
  }
  if (keyLevelsStructure.length === 0) {
    keyLevelsStructure.push(
      claim("Bounded gamma levels unavailable for the target session.", [
        gammaSpotId,
      ]),
    );
  }

  const upcomingHeadlines = catalysts
    .slice(0, 3)
    .map((c) => asString(c.headline))
    .filter((h): h is string => Boolean(h));
  const upcomingRisks =
    upcomingHeadlines.length > 0
      ? upcomingHeadlines.map((headline) =>
          claim(`Scheduled catalyst: ${headline}.`, [catalystEvidenceId]),
        )
      : [
          claim(
            "No tier-1 catalyst rows in the input packet for this window.",
            [catalystEvidenceId],
          ),
        ];

  return {
    marketRegime: claim(regimeText, [macroLabelId, gammaInterpId, gammaSpotId]),
    mainDrivers,
    keyLevelsStructure,
    upcomingRisks,
    scenarios: {
      bull: claim(
        "Conditional path if macro risk tone and bounded structure stay supportive without new shocks.",
        [macroRegimeId, gammaRegimeId],
      ),
      base: claim(
        "Status-quo path using the supplied macro and bounded structure facts only.",
        [macroLabelId, gammaSpotId],
      ),
      bear: claim(
        "Conditional path if listed catalysts or structure inputs in the packet deteriorate.",
        [catalystEvidenceId, gammaRegimeId],
      ),
    },
  };
}
