import type { StudyEvidenceBundle } from "@/contracts";
import type { StudyMemoNarratorOutput } from "@/contracts";
import type { StudyMemoCitationEntry } from "./citation-catalog";

export interface StudyMemoNarratorUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type StudyMemoNarratorFailureCategory =
  | "missing_api_key"
  | "http_error"
  | "provider_parse"
  | "citation_resolution"
  | "provider_error";

export type StudyMemoNarratorResult =
  | {
      readonly ok: true;
      readonly output: StudyMemoNarratorOutput;
      readonly provider: string;
      readonly model: string;
      readonly usage?: StudyMemoNarratorUsage;
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly provider: string;
      readonly model: string;
      readonly error: string;
      readonly unavailable?: boolean;
      readonly attempts: number;
      readonly failureCategory: StudyMemoNarratorFailureCategory;
    };

export interface StudyMemoInputPacket {
  readonly bundleId: string;
  readonly bundleSchemaVersion: string;
  readonly studyId: string;
  readonly sessionDate: string;
  readonly symbol?: string;
  readonly evidenceStatus: StudyEvidenceBundle["evidenceStatus"];
  readonly primaryHorizon: StudyEvidenceBundle["primaryHorizon"];
  readonly cohortQuality: StudyEvidenceBundle["cohortQuality"];
  readonly matchCriteria: StudyEvidenceBundle["matchCriteria"];
  readonly statusBasis: StudyEvidenceBundle["statusBasis"];
  readonly horizonEvidence: StudyEvidenceBundle["horizonEvidence"];
  readonly queryMatchFields: Record<string, string>;
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
  readonly sources: StudyEvidenceBundle["sources"];
  readonly citationCatalog: readonly StudyMemoCitationEntry[];
}

export interface StudyMemoNarrator {
  readonly providerId: string;
  narrate(packet: StudyMemoInputPacket): Promise<StudyMemoNarratorResult>;
}
