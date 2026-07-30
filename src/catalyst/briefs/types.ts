import type { OfficialBrief } from "@/contracts";

export interface BriefInputDocumentRef {
  readonly documentId: string;
  readonly contentHash: string;
  readonly documentType: string;
  readonly releaseFamily: string;
  readonly publishedAt: string;
}

export interface BriefRevisionRecord {
  readonly documentId: string;
  readonly observedAt: string;
  readonly previousContentHash: string;
  readonly currentContentHash: string;
  readonly previousBriefId: string;
  readonly currentBriefId: string;
  readonly reason: "document_revision" | "extractor_version";
}

export interface BriefBuildError {
  readonly documentId: string;
  readonly error: string;
}

export type BriefsBuildStatus = "ok" | "partial" | "failed";

/** On-disk cache written by `npm run catalyst:briefs:build` (gitignored). */
export interface CatalystBriefsCache {
  readonly kind: "CatalystBriefsCache";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly extractorVersion: string;
  readonly buildStatus: BriefsBuildStatus;
  readonly inputDocuments: readonly BriefInputDocumentRef[];
  readonly briefs: OfficialBrief[];
  readonly revisions: BriefRevisionRecord[];
  readonly warnings: string[];
  readonly errors: BriefBuildError[];
}
