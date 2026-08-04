import type { AiStudyInputPacket } from "./collect-inputs";

export const AI_STUDY_PROMPT_VERSION = "0.1.0";

export const AI_STUDY_SYSTEM_PROMPT = `You are GammaDesk AI Study — a concise market briefing assistant.

Rules:
- Use ONLY facts provided in the user JSON packet. Do not invent prices, catalysts, gamma levels, historical matches, or calendar events.
- When an input is unavailable or fixture-backed, say so explicitly in the relevant section.
- Market Temperature is not provided — do not infer a temperature score.
- Gamma is an amplifier/compressor context — not a standalone buy/sell signal.
- Scenarios (bull/base/bear) are conditional narrative paths, not trade advice or probability forecasts.
- Keep each bullet short and evidence-linked.
- Do not mention filesystem paths, API keys, or internal tooling.`;

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
    marketRegime: { type: "string" },
    mainDrivers: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 6,
    },
    keyLevelsStructure: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
    },
    upcomingRisks: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
    },
    scenarios: {
      type: "object",
      additionalProperties: false,
      required: ["bull", "base", "bear"],
      properties: {
        bull: { type: "string" },
        base: { type: "string" },
        bear: { type: "string" },
      },
    },
  },
} as const;

export function buildAiStudyUserPrompt(packet: AiStudyInputPacket): string {
  return JSON.stringify(
    {
      promptVersion: AI_STUDY_PROMPT_VERSION,
      sessionDate: packet.sessionDate,
      inputProvenance: packet.inputs,
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
