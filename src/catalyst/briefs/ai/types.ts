import type { OfficialAiBrief } from "@/contracts";

export interface AiBriefInputRef {
  readonly inputBriefId: string;
  readonly documentId: string;
  readonly documentContentHash: string;
  readonly extractorVersion: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly publishedAt?: string;
}

export interface AiBriefUsageRecord {
  readonly inputBriefId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiBriefBuildError {
  readonly inputBriefId: string;
  readonly error: string;
  readonly status?: OfficialAiBrief["status"];
}

export type AiBriefsBuildStatus = "ok" | "partial" | "failed" | "unavailable";

export interface CatalystAiBriefsCache {
  readonly kind: "CatalystAiBriefsCache";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly extractorVersion: string;
  readonly buildStatus: AiBriefsBuildStatus;
  readonly inputRefs: readonly AiBriefInputRef[];
  readonly briefs: OfficialAiBrief[];
  readonly usage: AiBriefUsageRecord[];
  readonly errors: AiBriefBuildError[];
  readonly warnings: string[];
}
