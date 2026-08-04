import type { StudyEvidenceBundle } from "@/contracts";
import type { StudyMemoInputPacket } from "./narrator";

function symbolSuffix(symbol: string | undefined): string {
  return symbol ? ` for ${symbol}` : "";
}

/** Deterministic headline template per evidenceStatus — not model-generated. */
export function buildStudyMemoHeadline(input: {
  readonly evidenceStatus: StudyEvidenceBundle["evidenceStatus"];
  readonly primaryHorizon: StudyEvidenceBundle["primaryHorizon"];
  readonly symbol?: string;
}): string {
  const sym = symbolSuffix(input.symbol);
  switch (input.evidenceStatus) {
    case "supported":
      return `Supported historical cohort evidence${sym} at the ${input.primaryHorizon} primary horizon`;
    case "mixed":
      return `Mixed historical cohort evidence${sym} at the ${input.primaryHorizon} primary horizon`;
    case "not_supported":
      return `Not supported historical cohort evidence${sym} at the ${input.primaryHorizon} primary horizon`;
    case "insufficient_evidence":
      return `Insufficient historical cohort evidence${sym} at the ${input.primaryHorizon} primary horizon`;
    default: {
      const _exhaustive: never = input.evidenceStatus;
      return `Historical cohort evidence${sym} at the ${_exhaustive} primary horizon`;
    }
  }
}

export function buildStudyMemoHeadlineFromPacket(
  packet: StudyMemoInputPacket,
): string {
  return buildStudyMemoHeadline({
    evidenceStatus: packet.evidenceStatus,
    primaryHorizon: packet.primaryHorizon,
    symbol: packet.symbol,
  });
}
