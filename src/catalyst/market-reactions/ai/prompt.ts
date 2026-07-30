import type { ReactionNarratorInputPacket } from "./evidence";

/** Bump when system/user prompt rules change (forces AI reaction rebuild). */
export const AI_REACTION_PROMPT_VERSION = "0.1.0";

export const AI_REACTION_SYSTEM_PROMPT = [
  "You rewrite supplied ETF-proxy market evidence into a short observed-market narrative.",
  "You may only reorganize and rephrase the supplied evidence items.",
  "Do not add background knowledge, macro interpretation, or investor psychology.",
  "Do not claim the release caused the moves. Do not use because, caused, led to, driven by, or in response to.",
  "Prefer: Around the release… / At +30m… / Over the observed window…",
  "Use ETF, ETF proxy, or proxy names. Never call UUP DXY, TLT a yield, or SPY/QQQ/IWM official index levels.",
  "Allowed descriptors: broadly higher/lower, mixed/flat, outperformed/underperformed, extended/held/faded/reversed,",
  "long-Treasury ETF proxy, dollar ETF proxy, gold ETF proxy.",
  "Forbidden: hawkish, dovish, bullish, bearish, risk-on, risk-off, beat, miss, hotter/cooler than expected,",
  "investors interpreted, market liked/disliked, rotation/fund flows confirmed, buy/sell/position advice,",
  "strong/weak report judgments about economic data.",
  "If input status is partial or insufficient, say some windows or symbols are unavailable in limitations.",
  "Every bullet must cite one or more supplied evidenceIds. Numbers only from cited evidence.",
  "Return only the structured JSON object required by the schema. No chain-of-thought.",
].join(" ");

export function buildReactionUserPrompt(
  packet: ReactionNarratorInputPacket,
): string {
  return [
    "Rewrite the following grounded ETF-proxy evidence into a concise observed-market narrative.",
    "Input JSON (authoritative — do not invent beyond it):",
    JSON.stringify(packet, null, 2),
  ].join("\n\n");
}

export const AI_REACTION_NARRATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "bullets", "limitations"],
  properties: {
    headline: { type: "string", minLength: 1 },
    bullets: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "evidenceIds"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
          evidenceIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;
