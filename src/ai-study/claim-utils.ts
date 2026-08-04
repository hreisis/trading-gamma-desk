import type { AiStudyClaim } from "@/contracts/ai-study-briefing";

export function claimText(value: AiStudyClaim | string): string {
  return typeof value === "string" ? value : value.text;
}

export function claimEvidenceIds(value: AiStudyClaim | string): string[] {
  return typeof value === "string" ? [] : value.evidenceIds;
}
