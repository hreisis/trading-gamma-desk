import type { AiMarketReactionNarrative } from "@/contracts";

export interface AiMarketReactionInputRef {
  readonly catalystId: string;
  readonly marketContextId: string;
  readonly marketContextIdentity: string;
  readonly marketReactionId: string;
  readonly marketReactionIdentity: string;
  readonly reactionRulesVersion: string;
  readonly promptVersion: string;
  readonly model: string;
}

export interface AiMarketReactionUsageRecord {
  readonly catalystId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiMarketReactionBuildError {
  readonly catalystId: string;
  readonly error: string;
  readonly status?: AiMarketReactionNarrative["status"];
}

export interface AiMarketReactionRevisionRecord {
  readonly catalystId: string;
  readonly previousId: string;
  readonly currentId: string;
  readonly observedAt: string;
  readonly reason: string;
}

export type AiMarketReactionsBuildStatus =
  | "ok"
  | "partial"
  | "failed"
  | "unavailable";

export interface CatalystAiMarketReactionsCache {
  readonly kind: "CatalystAiMarketReactionsCache";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly reactionRulesVersion: string;
  readonly buildStatus: AiMarketReactionsBuildStatus;
  readonly inputRefs: readonly AiMarketReactionInputRef[];
  readonly narratives: AiMarketReactionNarrative[];
  readonly usage: AiMarketReactionUsageRecord[];
  readonly revisions: AiMarketReactionRevisionRecord[];
  readonly errors: AiMarketReactionBuildError[];
  readonly warnings: string[];
}
