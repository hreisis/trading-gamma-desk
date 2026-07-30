import type { OfficialBrief } from "@/contracts";
import type { NarratorInputPacket } from "./narrator";

/** Bump when system/user prompt rules change (forces AI brief rebuild). */
export const AI_BRIEF_PROMPT_VERSION = "0.1.0";

export const AI_BRIEF_SYSTEM_PROMPT = [
  "You rewrite supplied official-release facts into a short, readable brief.",
  "You may only reorganize and rephrase the supplied facts and their evidence excerpts.",
  "Do not add background knowledge, missing context, or market interpretation.",
  "Do not guess omissions. Do not describe market reactions.",
  "Forbidden language: hawkish, dovish, bullish, bearish, beat, miss, hotter than expected, cooler than expected, buy, sell, overweight, underweight, position, risk-on, risk-off as advice.",
  "When consensus is unavailable, do not imply above/below expectations.",
  "Do not give trading, positioning, or risk-preference advice.",
  "If the input status is partial, say the summary is incomplete in limitations.",
  "Every bullet must cite one or more supplied factIds.",
  "Return only the structured JSON object required by the schema. No chain-of-thought.",
].join(" ");

export function buildNarratorInputPacket(
  brief: OfficialBrief,
  meta: {
    readonly provider: string;
    readonly publishedAt: string;
    readonly sourceName: string;
  },
): NarratorInputPacket {
  return {
    briefId: brief.id,
    documentId: brief.documentId,
    documentContentHash: brief.documentContentHash,
    extractorVersion: brief.extractorVersion,
    releaseFamily: brief.releaseFamily,
    referencePeriod: brief.referencePeriod,
    status: brief.status,
    provider: meta.provider,
    sourceName: meta.sourceName,
    publishedAt: meta.publishedAt,
    facts: brief.facts.map((f) => ({
      id: f.id,
      label: f.label,
      text: f.text,
      factType: f.factType,
      values: f.values,
      evidenceExcerpt: f.evidence.excerpt,
      crossCheck: f.crossCheck
        ? {
            status: f.crossCheck.status,
            structuredMetric: f.crossCheck.structuredMetric,
            structuredActual: f.crossCheck.structuredActual,
          }
        : undefined,
    })),
    omissions: brief.omissions,
    warnings: brief.warnings,
  };
}

export function buildUserPrompt(packet: NarratorInputPacket): string {
  return [
    "Rewrite the following grounded facts into a concise official-release brief.",
    "Input JSON (authoritative — do not invent beyond it):",
    JSON.stringify(packet, null, 2),
  ].join("\n\n");
}

/** JSON Schema for OpenAI strict structured outputs (model response body). */
export const AI_NARRATOR_JSON_SCHEMA = {
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
        required: ["id", "text", "factIds"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
          factIds: {
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
