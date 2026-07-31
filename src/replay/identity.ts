import type { ReplaySourceKind } from "@/contracts";

export function buildReplayFrameId(
  runId: string,
  evaluationAt: string,
): string {
  return `frame|${runId}|${evaluationAt}`;
}

export function buildMacroArtifactId(
  marketSessionDate: string,
  generatedAt: string,
): string {
  return `macro|${marketSessionDate}|${generatedAt}`;
}

export function buildStructureArtifactId(snapshotId: string): string {
  return `structure|${snapshotId}`;
}

export function buildCatalystArtifactId(catalystId: string): string {
  return `catalyst|${catalystId}`;
}

export function unavailableReason(
  sourceKind: ReplaySourceKind,
  detail: string,
): string {
  return `${sourceKind}: ${detail}`;
}
