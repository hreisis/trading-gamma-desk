import type { EventMarketReaction } from "@/contracts";

export interface MarketReactionInputRef {
  readonly catalystId: string;
  readonly marketContextId: string;
  readonly marketContextIdentity: string;
  readonly reactionRulesVersion: string;
  readonly marketContextCalculationVersion?: string;
}

export interface MarketReactionRevisionRecord {
  readonly catalystId: string;
  readonly previousId: string;
  readonly currentId: string;
  readonly observedAt: string;
  readonly reason: string;
}

export interface MarketReactionBuildError {
  readonly catalystId: string;
  readonly error: string;
  readonly status?: EventMarketReaction["status"];
}

export type MarketReactionsBuildStatus =
  | "ok"
  | "partial"
  | "failed"
  | "unavailable";

export interface CatalystMarketReactionsCache {
  readonly kind: "CatalystMarketReactionsCache";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly reactionRulesVersion: string;
  readonly buildStatus: MarketReactionsBuildStatus;
  readonly inputRefs: readonly MarketReactionInputRef[];
  readonly reactions: EventMarketReaction[];
  readonly revisions: MarketReactionRevisionRecord[];
  readonly errors: MarketReactionBuildError[];
  readonly warnings: string[];
}
