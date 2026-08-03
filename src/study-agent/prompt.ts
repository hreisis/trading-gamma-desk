import type { StudyEvidenceBundle } from "@/contracts";
import type { StudyMemoInputPacket } from "./narrator";

/** Bump when system/user prompt rules change (forces memo rebuild). */
export const STUDY_MEMO_PROMPT_VERSION = "0.1.0";

export const STUDY_MEMO_SYSTEM_PROMPT = [
  "You write a constrained study memo from a precomputed StudyEvidenceBundle JSON packet.",
  "The packet is authoritative — do not add facts, prices, symbols not present, or new statistics.",
  "Do not compute or restate math beyond what the cited bundle fields already contain.",
  "Separate content into evidence (directly stated bundle facts), inference (careful interpretation tied to cited fields), limitations (method/data constraints), and unknowns (gaps or unresolved items).",
  "Every bullet must cite one or more bundleFieldPaths that exist in the packet.",
  "When evidenceStatus is insufficient_evidence, abstain: keep inference empty, explain unknowns/limitations only.",
  "Forbidden: buy, sell, long, short, overweight, underweight, take profit, stop loss, bullish, bearish, hawkish, dovish, will rally, will fall, predict, forecast, expect returns, trading advice, or directional trade signals.",
  "Do not predict future prices or recommend actions.",
  "Return only the structured JSON object required by the schema. No chain-of-thought.",
].join(" ");

export function buildStudyMemoInputPacket(
  bundle: StudyEvidenceBundle,
): StudyMemoInputPacket {
  const availableFields: Record<string, string> = {};
  for (const [key, field] of Object.entries(
    bundle.queryContext.matchProfile.fields,
  )) {
    if (field.status === "available") {
      availableFields[key] = field.value;
    }
  }

  return {
    bundleId: bundle.bundleId,
    bundleSchemaVersion: bundle.schemaVersion,
    studyId: bundle.studyId,
    sessionDate: bundle.queryContext.sessionDate,
    symbol: bundle.queryContext.symbol,
    evidenceStatus: bundle.evidenceStatus,
    primaryHorizon: bundle.primaryHorizon,
    cohortQuality: bundle.cohortQuality,
    matchCriteria: bundle.matchCriteria,
    statusBasis: bundle.statusBasis,
    horizonEvidence: bundle.horizonEvidence,
    queryMatchFields: availableFields,
    limitations: bundle.limitations,
    warnings: bundle.cohortQuality.warnings,
    sources: bundle.sources,
  };
}

export function buildStudyMemoUserPrompt(packet: StudyMemoInputPacket): string {
  return [
    "Write a study memo from the following StudyEvidenceBundle packet.",
    "Use bundleFieldPaths like bundle.evidenceStatus, bundle.horizonEvidence.d5.aggregate.meanReturn, bundle.cohortQuality.matchedStudyCount, etc.",
    "Input JSON (authoritative — do not invent beyond it):",
    JSON.stringify(packet, null, 2),
  ].join("\n\n");
}

/** JSON Schema for OpenAI strict structured outputs (model response body). */
export const STUDY_MEMO_NARRATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "evidence", "inference", "limitations", "unknowns"],
  properties: {
    headline: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      minItems: 1,
      items: memoBulletSchema(),
    },
    inference: {
      type: "array",
      items: memoBulletSchema(),
    },
    limitations: {
      type: "array",
      items: memoBulletSchema(),
    },
    unknowns: {
      type: "array",
      items: memoBulletSchema(),
    },
  },
} as const;

function memoBulletSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "text", "bundleFieldPaths"],
    properties: {
      id: { type: "string", minLength: 1 },
      text: { type: "string", minLength: 1 },
      bundleFieldPaths: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
      },
    },
  } as const;
}
