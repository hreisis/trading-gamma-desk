import type { AiStudyInputPacket } from "./collect-inputs";

export const AI_STUDY_PROMPT_VERSION = "0.2.0";

export const AI_STUDY_SYSTEM_PROMPT = `You are GammaDesk AI Study — a concise market briefing assistant.

Rules:
- Use ONLY facts provided in the user JSON packet. Do not invent prices, catalysts, gamma levels, historical matches, or calendar events.
- Every claim MUST include evidenceIds referencing ids from evidenceCatalog only.
- evidenceIds MUST be exact strings copied from the evidenceCatalog array — never invent ids.
- When an input is unavailable or fixture-backed, say so explicitly in the relevant claim text.
- Market Temperature is not provided — do not infer a temperature score.
- Gamma is an amplifier/compressor context — not a standalone buy/sell signal.
- Scenarios (bull/base/bear) are conditional narrative paths, not trade advice or probability forecasts.
- Keep each claim text short and evidence-linked.
- Do not mention filesystem paths, API keys, or internal tooling.`;

const claimSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidenceIds"],
  properties: {
    text: { type: "string" },
    evidenceIds: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
    },
  },
} as const;

export const AI_STUDY_NARRATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "marketRegime",
    "mainDrivers",
    "keyLevelsStructure",
    "upcomingRisks",
    "scenarios",
  ],
  properties: {
    marketRegime: claimSchema,
    mainDrivers: {
      type: "array",
      items: claimSchema,
      minItems: 1,
      maxItems: 6,
    },
    keyLevelsStructure: {
      type: "array",
      items: claimSchema,
      minItems: 1,
      maxItems: 8,
    },
    upcomingRisks: {
      type: "array",
      items: claimSchema,
      minItems: 1,
      maxItems: 8,
    },
    scenarios: {
      type: "object",
      additionalProperties: false,
      required: ["bull", "base", "bear"],
      properties: {
        bull: claimSchema,
        base: claimSchema,
        bear: claimSchema,
      },
    },
  },
} as const;

export function buildAiStudyUserPrompt(packet: AiStudyInputPacket): string {
  return JSON.stringify(
    {
      promptVersion: AI_STUDY_PROMPT_VERSION,
      sessionDate: packet.sessionDate,
      sessionAlignment: packet.sessionAlignment,
      inputProvenance: packet.inputs,
      evidenceCatalog: packet.evidenceIds,
      facts: packet.facts,
      outputSections: [
        "marketRegime",
        "mainDrivers",
        "keyLevelsStructure",
        "upcomingRisks",
        "scenarios.bull",
        "scenarios.base",
        "scenarios.bear",
      ],
    },
    null,
    2,
  );
}
