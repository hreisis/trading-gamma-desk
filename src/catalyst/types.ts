import type {
  Catalyst,
  CatalystCategory,
  CatalystDirection,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystReleaseFamily,
  CatalystSourceType,
  CatalystStatus,
  EventMarketContext,
  EventMarketReaction,
  OfficialAiBrief,
  OfficialBrief,
  OfficialDocument,
  ReleaseObservation,
  ReleaseResult,
} from "@/contracts";
import type { OfficialCalendarSourceId } from "./registry";
import type { DocumentProviderStatus } from "./documents/types";

/**
 * Raw upstream-shaped event before canonicalization.
 * Synthetic fixtures use `synthetic: true`; official schedules use `false`.
 */
export interface CatalystRawEvent {
  readonly kind?: string;
  readonly synthetic?: boolean;
  readonly externalId?: string;
  readonly occurredAt?: string;
  readonly observedAt?: string;
  readonly sourceType?: string;
  readonly sourceName?: string;
  readonly sourceUrl?: string | null;
  readonly headline?: string;
  readonly summary?: string;
  readonly rawCategory?: string;
  readonly rawStatus?: string;
  readonly rawImportance?: string;
  readonly rawDirection?: string;
  readonly affectedAssets?: readonly string[];
  readonly macroChannels?: readonly string[];
  readonly evidenceStatements?: readonly string[];
  /** Evidence basis string written onto each evidence row. */
  readonly evidenceBasis?: string;
  /** When set, replaces a prior event with the same dedupe/external identity. */
  readonly supersedesExternalId?: string;
  readonly releaseFamily?: CatalystReleaseFamily;
  /** YYYY-MM from official schedule metadata when available. */
  readonly referencePeriod?: string;
  readonly releaseResult?: ReleaseResult;
}

export interface NormalizeOk {
  readonly ok: true;
  readonly catalyst: Catalyst;
}

export interface NormalizeErr {
  readonly ok: false;
  readonly error: string;
  readonly path?: string;
  readonly raw?: unknown;
}

export type NormalizeResult = NormalizeOk | NormalizeErr;

export interface CatalystQuery {
  readonly category?: CatalystCategory;
  readonly status?: CatalystStatus;
  readonly importance?: CatalystImportance;
  readonly affectedAsset?: string;
  readonly start?: string;
  readonly end?: string;
}

export type CatalystFeedMode =
  | "synthetic_demo"
  | "official_calendar"
  | "stale_calendar"
  | "live_unavailable";

export type CatalystSourceStatus = "ok" | "error" | "skipped";

export interface CatalystFeedSourceStatus {
  readonly id: OfficialCalendarSourceId | "fixture";
  readonly name: string;
  readonly url?: string;
  readonly status: CatalystSourceStatus;
  readonly error?: string;
  readonly mappedEventCount?: number;
}

export interface CatalystFeedResponse {
  readonly kind: "CatalystFeed";
  readonly schemaVersion: "0.1.0";
  readonly generatedAt: string;
  readonly mode: CatalystFeedMode;
  readonly isPublicDemo: boolean;
  readonly banner: string;
  readonly disclaimer: string;
  readonly source: {
    readonly type: "fixture" | "official_calendar";
    readonly name: string;
    readonly synthetic: boolean;
    readonly fetchedAt?: string;
    readonly stale?: boolean;
    readonly partialFailure?: boolean;
    readonly window?: {
      readonly now: string;
      readonly start: string;
      readonly end: string;
    };
    readonly sources?: readonly CatalystFeedSourceStatus[];
    readonly results?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly partialFailure?: boolean;
      readonly status?: "ok" | "error" | "missing" | "synthetic";
      readonly error?: string;
      /**
       * Archive metadata only — full historical periods live in
       * results-latest.json and must not inflate the default catalysts array.
       */
      readonly archiveReleaseCount?: number;
      readonly materializedStandaloneCount?: number;
      readonly linkedCount?: number;
    };
    readonly documents?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly partialFailure?: boolean;
      readonly status?: "ok" | "error" | "missing" | "synthetic";
      readonly error?: string;
      readonly archiveDocumentCount?: number;
      readonly feedDocumentCount?: number;
      readonly linkedCount?: number;
      readonly sources?: readonly DocumentProviderStatus[];
    };
    readonly briefs?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly status?: "ok" | "error" | "missing" | "synthetic" | "partial" | "failed";
      readonly error?: string;
      readonly archiveBriefCount?: number;
      readonly feedBriefCount?: number;
      readonly extractorVersion?: string;
    };
    readonly aiBriefs?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly status?:
        | "ok"
        | "error"
        | "missing"
        | "synthetic"
        | "partial"
        | "failed"
        | "unavailable";
      readonly error?: string;
      readonly archiveBriefCount?: number;
      readonly feedBriefCount?: number;
      readonly promptVersion?: string;
      readonly model?: string;
    };
    readonly marketContext?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly status?:
        | "ok"
        | "error"
        | "missing"
        | "synthetic"
        | "partial"
        | "failed"
        | "unavailable";
      readonly error?: string;
      readonly archiveSnapshotCount?: number;
      readonly feedSnapshotCount?: number;
      readonly calculationVersion?: string;
      readonly provider?: string;
      readonly feed?: string;
    };
    readonly marketReactions?: {
      readonly available: boolean;
      readonly fetchedAt?: string;
      readonly stale?: boolean;
      readonly status?:
        | "ok"
        | "error"
        | "missing"
        | "synthetic"
        | "partial"
        | "failed"
        | "unavailable";
      readonly error?: string;
      readonly archiveReactionCount?: number;
      readonly feedReactionCount?: number;
      readonly reactionRulesVersion?: string;
    };
  };
  readonly count: number;
  readonly catalysts: Catalyst[];
  /**
   * Default Official Updates window (≈30d). Archive may be larger in cache;
   * these rows are never expanded into additional catalysts.
   */
  readonly documents?: OfficialDocument[];
  /** Rule-based briefs for the default ~30d window (not AI). */
  readonly briefs?: OfficialBrief[];
  /** Evidence-grounded LLM narratives (M2-3C); may be empty when rejected/unavailable. */
  readonly aiBriefs?: OfficialAiBrief[];
  /** Observed ETF moves around releases (M2-4A); never causation claims. */
  readonly marketContext?: EventMarketContext[];
  /** Deterministic reaction patterns over M2-4A (M2-4B). */
  readonly marketReactions?: EventMarketReaction[];
  readonly validationErrors: Array<{
    readonly index: number;
    readonly error: string;
    readonly externalId?: string;
  }>;
  readonly linkingWarnings?: Array<{
    readonly error: string;
    readonly releaseFamily?: string;
    readonly referencePeriod?: string;
    readonly reason?: string;
  }>;
  readonly documentLinkingWarnings?: Array<{
    readonly error: string;
    readonly documentId?: string;
    readonly releaseFamily?: string;
    readonly referencePeriod?: string;
    readonly reason?: string;
  }>;
}

/** On-disk cache written by `npm run catalyst:fetch` (gitignored). */
export interface CatalystCalendarCache {
  readonly kind: "CatalystCalendarCache";
  readonly schemaVersion: "0.1.0";
  readonly fetchedAt: string;
  readonly requestedWindow: {
    readonly now: string;
    readonly start: string;
    readonly end: string;
  };
  readonly sources: readonly CatalystFeedSourceStatus[];
  readonly catalysts: Catalyst[];
  readonly validationErrors: Array<{
    readonly index: number;
    readonly error: string;
    readonly externalId?: string;
  }>;
  readonly partialFailure: boolean;
}

export type {
  Catalyst,
  CatalystCategory,
  CatalystDirection,
  CatalystImportance,
  CatalystMacroChannel,
  CatalystReleaseFamily,
  CatalystSourceType,
  CatalystStatus,
  EventMarketContext,
  EventMarketReaction,
  OfficialAiBrief,
  OfficialBrief,
  OfficialDocument,
  ReleaseObservation,
  ReleaseResult,
};
