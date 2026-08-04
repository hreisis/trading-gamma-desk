import type {
  EvidenceStatus,
  MarketStructureStateV2,
  StructureConditionState,
} from "@/contracts";
import type { DeskStance } from "@/contracts/decision-surface";

const PROHIBITED =
  /\b(buy|sell|long|short|overweight|underweight|probability|likely to rally|likely to fall|go long|go short|size up|size down)\b/i;

function evidenceStatusPhrase(status: EvidenceStatus): string {
  switch (status) {
    case "supported":
      return "Historical similar-regime cohort statistics are supported (descriptive only — not a directional forecast).";
    case "mixed":
      return "Historical similar-regime cohort statistics are mixed — interpret with cohort limitations.";
    case "not_supported":
      return "Historical similar-regime cohort statistics do not support a positive cohort read.";
    case "insufficient_evidence":
      return "Similar-regime evidence is insufficient for inference — abstain from extending the historical read.";
  }
}

function structurePhrase(structure: MarketStructureStateV2 | null): string {
  if (!structure) {
    return "Bounded structure context is unavailable for this session.";
  }
  return `Bounded structure context (${structure.condition.replaceAll("_", " ")}): ${structure.interpretation.summary}`;
}

/**
 * Deterministic non-trade desk stance from evidence status + bounded structure.
 * No sizing, orders, probabilities, or directional trade language.
 */
export function buildDeskStance(input: {
  readonly sessionDate: string;
  readonly evidenceStatus: EvidenceStatus;
  readonly structure: MarketStructureStateV2 | null;
}): DeskStance {
  const summary = `${evidenceStatusPhrase(input.evidenceStatus)} ${structurePhrase(input.structure)}`;
  if (PROHIBITED.test(summary)) {
    throw new Error("desk stance produced prohibited trade language");
  }

  return {
    kind: "DeskStance",
    schemaVersion: "0.1.0",
    sessionDate: input.sessionDate,
    summary,
    evidenceStatus: input.evidenceStatus,
    structureCondition: input.structure?.condition ?? null,
    nonTrade: true,
  };
}

export function structureConditionLabel(
  condition: StructureConditionState | null | undefined,
): string {
  if (!condition) return "Unavailable";
  return condition.replaceAll("_", " ");
}
