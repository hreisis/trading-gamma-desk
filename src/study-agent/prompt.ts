import type { StudyEvidenceBundle } from "@/contracts";
import { buildCitationCatalog } from "./citation-catalog";
import type { StudyMemoInputPacket } from "./narrator";

/** Bump when system/user prompt rules change (forces memo rebuild). */
export const STUDY_MEMO_PROMPT_VERSION = "0.1.2";

export const STUDY_MEMO_SYSTEM_PROMPT = [
  "You write a constrained study memo from a precomputed StudyEvidenceBundle JSON packet and citation catalog.",
  "The packet and citation catalog are authoritative — do not add facts, prices, symbols not present, or new statistics.",
  "Do not compute or restate math beyond what the cited catalog entries already contain.",
  "Separate content into evidence (directly stated bundle facts), inference (careful interpretation tied to cited entries), limitations (method/data constraints), and unknowns (gaps or unresolved items).",
  "Every bullet must cite one or more citationIds from the provided catalog — never invent IDs or raw bundle paths.",
  "The first evidence bullet must cite evidence_status and primary_horizon.",
  "For array-valued fields such as limitations, cite the whole-field catalog ID (e.g. limitations) — never indexed paths.",
  "When evidenceStatus is insufficient_evidence, abstain: keep inference empty, explain unknowns/limitations only.",
  "Do not write a headline — the application assigns a deterministic headline.",
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

  const citationCatalog = buildCitationCatalog(bundle);

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
    citationCatalog: citationCatalog.entries,
  };
}

export function buildStudyMemoUserPrompt(packet: StudyMemoInputPacket): string {
  return [
    "Write a study memo from the following StudyEvidenceBundle packet.",
    "Cite only citationIds listed in the catalog below — each ID maps to one canonical bundle path.",
    "The first evidence bullet must include citationIds: evidence_status and primary_horizon.",
    "Use exact numeric values from cited catalog previews; do not invent numbers.",
    "Citation catalog (allowed IDs only):",
    JSON.stringify(packet.citationCatalog, null, 2),
    "Input JSON (authoritative context — do not invent beyond it):",
    JSON.stringify(
      {
        bundleId: packet.bundleId,
        sessionDate: packet.sessionDate,
        symbol: packet.symbol,
        evidenceStatus: packet.evidenceStatus,
        primaryHorizon: packet.primaryHorizon,
        cohortQuality: packet.cohortQuality,
        statusBasis: packet.statusBasis,
        horizonEvidence: packet.horizonEvidence,
        limitations: packet.limitations,
        warnings: packet.warnings,
      },
      null,
      2,
    ),
  ].join("\n\n");
}

/** JSON Schema for OpenAI strict structured outputs (model response body). */
export const STUDY_MEMO_NARRATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["evidence", "inference", "limitations", "unknowns"],
  properties: {
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
    required: ["id", "text", "citationIds"],
    properties: {
      id: { type: "string", minLength: 1 },
      text: { type: "string", minLength: 1 },
      citationIds: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
      },
    },
  } as const;
}
