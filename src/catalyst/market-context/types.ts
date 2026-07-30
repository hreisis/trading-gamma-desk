import type { EventMarketContext } from "@/contracts";

export interface MarketContextInputRef {
  readonly catalystId: string;
  readonly eventTimestamp: string;
  readonly provider: string;
  readonly feed: string;
  readonly symbols: string;
  readonly calculationVersion: string;
}

export interface MarketContextRevisionRecord {
  readonly catalystId: string;
  readonly previousId: string;
  readonly currentId: string;
  readonly observedAt: string;
  readonly reason: string;
}

export interface MarketContextBuildError {
  readonly catalystId: string;
  readonly error: string;
  readonly status?: EventMarketContext["status"];
}

export type MarketContextBuildStatus =
  | "ok"
  | "partial"
  | "failed"
  | "unavailable";

export interface CatalystMarketContextCache {
  readonly kind: "CatalystMarketContextCache";
  readonly schemaVersion: "0.1.0";
  readonly fetchedAt: string;
  readonly provider: string;
  readonly feed: string;
  readonly calculationVersion: string;
  readonly buildStatus: MarketContextBuildStatus;
  readonly inputRefs: readonly MarketContextInputRef[];
  readonly snapshots: EventMarketContext[];
  readonly revisions: MarketContextRevisionRecord[];
  readonly errors: MarketContextBuildError[];
  readonly warnings: string[];
}
